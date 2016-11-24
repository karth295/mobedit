(function () {

    if (!React) {
        throw new Error("React is not loaded");
    }

    if (!SockJS) {
        throw new Error("SockJS is not loaded");
    }

    function sockjs_client(prefix, url) {
        var bus = this
        var recent_saves = []
        var sock
        var attempts = 0
        var outbox = []
        var fetched_keys = new bus.Set()
        var heartbeat
        url = url.replace(/^state:\/\//, 'https://')
        url = url.replace(/^statei:\/\//, 'http://')
        if (url[url.length-1]=='/') url = url.substr(0,url.length-1)
        function send (o, pushpop) {
            pushpop = pushpop || 'push'
            bus.log('sockjs.send:', JSON.stringify(o))
            outbox[pushpop](JSON.stringify(o))
            flush_outbox()
        }
        function flush_outbox() {
            if (sock.readyState === 1)
                while (outbox.length > 0)
                    sock.send(outbox.shift())
            else
                setTimeout(flush_outbox, 400)
        }
        bus(prefix).to_save   = function (obj) { send({method: 'save', obj: obj})
                                                 bus.save.fire(obj)
                                                 if (window.ignore_flashbacks)
                                                     recent_saves.push(JSON.stringify(obj))
                                                 if (recent_saves.length > 100) {
                                                     var extra = recent_saves.length - 100
                                                     recent_saves.splice(0, extra)
                                                 }
                                               }
        bus(prefix).to_fetch  = function (key) { send({method: 'fetch', key: key}),
                                                 fetched_keys.add(key) }
        bus(prefix).to_forget = function (key) { send({method: 'forget', key: key}),
                                                 fetched_keys.delete(key) }
        bus(prefix).to_delete = function (key) { send({method: 'delete', key: key}) }

        function connect () {
            console.log('%c[ ] trying to open ' + url, 'color: blue')
            sock = sock = new SockJS(url + '/statebus')
            sock.onopen = function()  {
                console.log('%c[*] opened ' + url, 'color: blue')

                var me = fetch('ls/me')
                bus.log('connect: me is', me)
                if (!me.client) {
                    me.client = (Math.random().toString(36).substring(2)
                                 + Math.random().toString(36).substring(2)
                                 + Math.random().toString(36).substring(2))
                    save(me)
                }
                send({method: 'save', obj: {key: '/current_user', client: me.client}},
                     'unshift')

                if (attempts > 0) {
                    // Then we need to refetch everything, cause it
                    // might have changed
                    recent_saves = []
                    var keys = fetched_keys.values()
                    for (var i=0; i<keys.length; i++)
                        send({method: 'fetch', key: keys[i]})
                }

                attempts = 0
                //heartbeat = setInterval(function () {send({method: 'ping'})}, 5000)
            }
            sock.onclose   = function()  {
                console.log('%c[*] closed ' + url, 'color: blue')
                heartbeat && clearInterval(heartbeat); heartbeat = null
                setTimeout(connect, attempts++ < 3 ? 1500 : 5000)

                // Remove all fetches and forgets from queue
                var new_outbox = []
                var bad = {'fetch':1, 'forget':1}
                for (var i=0; i<outbox.length; i++)
                    if (!bad[JSON.parse(outbox[i]).method])
                        new_outbox.push(outbox[i])
                outbox = new_outbox
            }

            sock.onmessage = function(event) {
                // Todo: Perhaps optimize processing of many messages
                // in batch by putting new messages into a queue, and
                // waiting a little bit for more messages to show up
                // before we try to re-render.  That way we don't
                // re-render 100 times for a function that depends on
                // 100 items from server while they come in.  This
                // probably won't make things render any sooner, but
                // will probably save energy.

                //console.log('[.] message')
                try {
                    var message = JSON.parse(event.data)
                    var method = message.method.toLowerCase()

                    // Convert v3 pubs to v4 saves for compatibility
                    if (method == 'pub') method = 'save'
                    // We only take saves from the server for now
                    if (method !== 'save' && method !== 'pong') throw 'barf'
                    bus.log('sockjs_client received', message.obj)

                    var is_recent_save = false
                    if (window.ignore_flashbacks) {
                        var s = JSON.stringify(message.obj)
                        for (var i=0; i<recent_saves.length; i++)
                            if (s === recent_saves[i]) {
                                is_recent_save = true
                                recent_saves.splice(i, 1)
                            }
                        // bus.log('Msg', message.obj.key,
                        //         is_recent_save?'is':'is NOT', 'a flashback')
                    }

                    if (!is_recent_save)
                        bus.save.fire(message.obj)
                        //setTimeout(function () {bus.announce(message.obj)}, 1000)
                } catch (err) {
                    console.error('Received bad sockjs message from '
                                  +url+': ', event.data, err)
                    return
                }
            }

        }
        connect()
    }

    function localstorage_client (prefix) {
        // This doesn't yet trigger updates across multiple browser windows.
        // We can do that by adding a list of dirty keys and 

        var bus = this
        bus.log(this)

        // Fetch returns the value immediately in a save
        // Saves are queued up, to store values with a delay, in batch
        var saves_are_pending = false
        var pending_saves = {}

        function save_the_pending_saves() {
            bus.log('localstore: saving', pending_saves)
            for (var k in pending_saves)
                localStorage.setItem(k, JSON.stringify(pending_saves[k]))
            saves_are_pending = false
        }

        bus(prefix).to_fetch = function (key) {
            var result = localStorage.getItem(key)
            return result ? JSON.parse(result) : {key: key}
        }
        bus(prefix).to_save = function (obj) {
            // Do I need to make this recurse into the object?
            bus.log('localStore: on_save:', obj.key)
            pending_saves[obj.key] = obj
            if (!saves_are_pending) {
                setTimeout(save_the_pending_saves, 50)
                saves_are_pending = true
            }
            bus.save.fire(obj)
            return obj
        }
        bus(prefix).to_delete = function (key) { localStorage.removeItem(key) }


        // Hm... this update stuff doesn't seem to work on file:/// urls in chrome
        function update (event) {
            bus.log('Got a localstorage update', event)
            //this.get(event.key.substr('statebus '.length))
        }
        if (window.addEventListener) window.addEventListener("storage", update, false)
        else                         window.attachEvent("onstorage", update)
    }

    window.bus = window.statebus();
    const cache = localStorage.getItem('*statebus_cache_invalid_key*');
    if (cache) {
        bus.paused = true;
        bus.cache = JSON.parse(cache);
    } else {
        bus.paused = false;
    }

    bus.pause = () => {
        if (!bus.paused) {
            bus.paused = true;
            localStorage.setItem('*statebus_cache_invalid_key*', JSON.stringify(bus.cache));
        }
    }
    bus.resume = () => {
        if (bus.paused) {
            bus.paused = false;
            localStorage.removeItem('*statebus_cache_invalid_key*');
        }
    }

    sockjs_client.bind(bus)('/*', window.statebus_server);
    localstorage_client.bind(bus)('ls/*');

    /*
     * Base class for statebus components who wish to bind statebus state
     * to component state
     *
     * XXX Currently assumes there's a statebus named "bus" in global scope
     */

    class StatebusComponent extends React.Component {
        constructor(props) {
            super(props);

            this.updateable = false;

            this.callbacks = new Map();
            this.statebus = new Proxy({},
            {
                get: (target, key, receiver) => {
                    console.assert(!key.includes('*'));
                    this.fetches.add(key);
                    if (!this.callbacks.has(key)) {
                        this.callbacks.set(key, (obj) => {
                            // render will fetch from bus.cache
                            this.forceUpdate();
                        });

                        if (this.updateable) {
                            // Ensure this doesn't run within render
                            setTimeout(() => {
                                bus.fetch(key, this.callbacks.get(key));
                            }, 0);
                        }
                    }

                    return (bus.cache[key] || {key: key}).value;
                },

                set: (target, key, value, receiver) => {
                    console.assert(!key.includes('*'));
                    if (!bus.paused) {
                        console.log("SAVING");
                        bus.save({
                            key: key,
                            value: value,
                        });
                    }

                    return true;
                }
            });

            this.previous_fetches = new Set();
            this.fetches = new Set();
            this._decorate('render', (original_render) => {
                this.previous_fetches = this.fetches;
                this.fetches = new Set();

                const render_value = original_render();

                // Unsubscribe from any keys that weren't fetched again
                for (let key of this.previous_fetches) {
                    if (!this.fetches.has(key)) {
                        bus.forget(key, this.callbacks.get(key));
                        this.callbacks.delete(key);
                    }
                }

                return render_value;
            });

            this._decorate('componentWillMount', (original_cwm) => {
                this.updateable = true;

                // fetch keys that we previously couldn't
                for (let [key, callback] of this.callbacks) {
                    bus.fetch(key, callback);
                }

                original_cwm();
            });

            this._decorate('componentWillUnmount', (original_cwu) => {
                original_cwu();

                for (let [key, callback] of this.callbacks) {
                    bus.forget(key, callback);
                }
                this.callbacks.clear();
            })
        }

        _decorate(property, decorator) {
            const old_func = this[property] || function(){};
            this[property] = () => {
                return decorator(old_func.bind(this));
            }
        }
    }

    // TODO: export
    window.StatebusComponent = StatebusComponent;
})()

