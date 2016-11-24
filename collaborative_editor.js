"use strict";

const AceRange = ace.require('ace/range').Range;

class CollaborativeEditor extends React.Component {
    constructor(props) {
        super(props);

        this.name = 'editor';
        this.id = Math.random();
        this.client = null;
        this.editor = null;
        this.skipChange = false;
    }

    createOTClient(revision) {
        this.client = new ot.Client(revision);
        window.client = this.client;

        bus('cursors').to_fetch = (key) => {
            const connections = bus.fetch('/connections').all || [];
            const cursors = connections
                .filter(el => el.cursor !== undefined && el.id != this.id)
                .map(el => el.cursor);

            return {
                all: cursors,
            }
        }

        bus.fetch('/ops', (ops) => {
            ops.all = ops.all || [];
            ops.ids = ops.ids || [];

            for (let i = this.client.revision; i < ops.all.length; i++) {
                const operation = ot.TextOperation.fromJSON(ops.all[i]);

                if (ops.ids[i] == this.client.currentId) {
                    this.client.serverAck();
                } else {
                    this.client.applyServer(operation);
                }
            }
        });

        this.client.applyOperation = (operation) => {
            let currentIndex = 0;
            const doc = this.editor.getSession().getDocument();
            for (const op of operation.ops) {
                if (ot.TextOperation.isRetain(op)) {
                    currentIndex += op;
                } else if (ot.TextOperation.isInsert(op)) {
                    this.skipChange = true;
                    doc.insert(doc.indexToPosition(currentIndex), op);
                    this.skipChange = false;

                    currentIndex += op.length;
                } else {
                    const start = doc.indexToPosition(currentIndex);
                    const end = doc.indexToPosition(currentIndex - op); // op is negative
                    const range = new AceRange(start.row, start.column, end.row, end.column);

                    this.skipChange = true;
                    doc.remove(range);
                    this.skipChange = false;
                }
            }
        };

        this.client.sendOperation = (revision, operation) => {
            this.client.currentId = Math.random().toString(36).substring(7);
            bus.save({
                key: '/op',
                revision: revision,
                operation: operation,
                id: this.client.currentId,
            });
        };
    }

    createEditor(text) {
        this.editor = ace.edit(this.name);
        window.editor = this.editor;
        this.editor.setValue(text, 1);
        this.editor.getSession().setMode("ace/mode/javascript");
        this.editor.setTheme("ace/theme/twilight");
        this.editor.focus();

        this.editor.on('change', (changeObj) => {
            if (this.skipChange) {
                return;
            }

            const totalLength = this.editor.getValue().length;
            const doc = this.editor.getSession().getDocument();
            const startPosition = doc.positionToIndex(changeObj.start);
            const diff = changeObj.lines.join('\n');

            const operation = new ot.TextOperation().retain(startPosition);
            if (changeObj.action == 'insert') {
                operation.insert(diff).retain(totalLength - (startPosition + diff.length));
            } else if (changeObj.action == 'remove') {
                operation.delete(diff).retain(totalLength - startPosition);
            } else {
                throw Error(`Unexpected action ${changeObj.action}`);
            }

            this.client.applyClient(operation);
        });

        this.editor.on('changeSelection', () => {
            const doc = this.editor.getSession().getDocument();
            bus.save({
                key: '/connection',
                id: this.id,
                cursor: doc.positionToIndex(this.editor.getCursorPosition()),
            });
        });

        bus.fetch('cursors', (cursors) => {
            const session = this.editor.getSession();
            const doc = session.getDocument();

            for (const markerid in session.getMarkers(true)) {
                session.removeMarker(markerid);
            }

            for (const cursorPos of cursors.all) {
                const cursorRowCol = doc.indexToPosition(cursorPos);
                const nextChar = {
                    row: cursorRowCol.row,
                    column: cursorRowCol.column + 1,
                }

                const cursorRange = new AceRange(
                    cursorRowCol.row, cursorRowCol.column,
                    cursorRowCol.row, cursorRowCol.column + 1);

                session.addMarker(cursorRange, 'cursor green-cursor', 'text', true);
            }
        });
    }

    componentDidMount() {
        const handlr = (document) => {
            if (document.text === undefined) {
                return;
            }

            this.createOTClient(document.revision);
            this.createEditor(document.text);

            bus.forget('/document', handlr);
        };
        bus.fetch('/document', handlr);
    }

    render() {
        return React.DOM.div({
            id: this.name,
            style: {
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                left: 0,
           },
        });
    }
}

