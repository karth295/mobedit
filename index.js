const bodyParser = require('body-parser');
const express = require('express');
const app = express();
app.use(bodyParser.json());

const ot = require('ot');

const bus = require('statebus/server')({
    port: 8004,
    file_store: false,
});

const server = new ot.Server("// Write some JS!");

const ids = [];

bus('/document').to_fetch = (key) => {
    return {
        revision: server.operations.length,
        text: server.document,
    }
}

bus('/ops').to_fetch = (key) => {
    return {
        all: server.operations,
        ids: ids,
    }
}

bus('/op').to_save = (obj) => {
    console.log(ot.TextOperation.fromJSON(obj.operation), server.document);
    server.receiveOperation(obj.revision, ot.TextOperation.fromJSON(obj.operation));
    ids.push(obj.id);

    bus.dirty('/ops');
}

app.use(express.static(__dirname + '/'));
app.listen(8000);
