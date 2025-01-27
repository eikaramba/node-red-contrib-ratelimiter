//Simple node to introduce a pause into a flow
module.exports = function(RED) {
    "use strict";

    var _maxKeptMsgsCount;

    function maxKeptMsgsCount(node) {
        if (_maxKeptMsgsCount === undefined) {
            var name = "nodeMessageBufferMaxLength";
            if (RED.settings.hasOwnProperty(name)) {
                _maxKeptMsgsCount = RED.settings[name];
            }
            else {
                _maxKeptMsgsCount = 0;
            }
        }
        return _maxKeptMsgsCount;
    }

    function RatelimiterNode(n) {
        RED.nodes.createNode(this,n);

        this.pauseType = n.pauseType;
        this.timeoutUnits = n.timeoutUnits;
        this.rateUnits = n.rateUnits;


        if (n.timeoutUnits === "milliseconds") {
            this.timeout = n.timeout;
        } else if (n.timeoutUnits === "minutes") {
            this.timeout = n.timeout * (60 * 1000);
        } else if (n.timeoutUnits === "hours") {
            this.timeout = n.timeout * (60 * 60 * 1000);
        } else if (n.timeoutUnits === "days") {
            this.timeout = n.timeout * (24 * 60 * 60 * 1000);
        } else {   // Default to seconds
            this.timeout = n.timeout * 1000;
        }

        if (n.rateUnits === "minute") {
            this.rate = (60 * 1000)/n.rate;
        } else if (n.rateUnits === "hour") {
            this.rate = (60 * 60 * 1000)/n.rate;
        } else if (n.rateUnits === "day") {
            this.rate = (24 * 60 * 60 * 1000)/n.rate;
        } else {  // Default to seconds
            this.rate = 1000/n.rate;
        }

        this.rate *= (n.nbRateUnits > 0 ? n.nbRateUnits : 1);

        // Add new properties for token bucket implementation
        this.lastSentTime = null;
        this.tokens = n.rate || 1;
        this.maxTokens = n.rate || 1;
        this.allowburst = n.allowburst || false;

        this.diff = this.randomLast - this.randomFirst;
        this.name = n.name;
        this.idList = [];
        this.buffer = [];
        this.intervalID = -1;
        this.lastSent = null;
        this.drop = n.drop;
        this.droppedMsgs = 0;
        this.allowrate = n.allowrate|| false;
        this.fixedrate = this.rate;
        this.outputs = n.outputs;
        var node = this;

        function ourTimeout(handler, delay, clearHandler) {
            var toutID = setTimeout(handler, delay);
            return {
                clear: function() { clearTimeout(toutID); clearHandler(); },
                trigger: function() { clearTimeout(toutID); return handler(); }
            };
        }

        var sendMsgFromBuffer = function() {
            if (node.buffer.length === 0) {
                clearInterval(node.intervalID);
                node.intervalID = -1;
            }
            if (node.buffer.length > 0) {
                const msgInfo = node.buffer.shift();
                if (Object.keys(msgInfo.msg).length > 1) {
                    msgInfo.send(msgInfo.msg);
                    msgInfo.done();
                }
            }
            node.reportDepth();
        }

        node.reportDepth = function() {
            if (!node.busy) {
                node.busy = setTimeout(function() {
                    node.status({fill:"blue",shape:"dot",text:node.buffer.length});
                    node.busy = null;
                }, 500);
            }
        }

        var loggerId = setInterval(function () {
            if (node.droppedMsgs !== 0) {
                node.debug("node.droppedMsgs = " + node.droppedMsgs);
                node.droppedMsgs = 0;
            }
        }, 15 * 1000);
        node.on("close", function() { clearInterval(loggerId); });


        this.topicTimestamps = new Map();
    this.topicBurstCredits = new Map();
    this.topicLastSentTime = new Map();

    node.on("input", function(msg, send, done) {
        if (node.drop) {
            const now = Date.now();

            // Initialize tracking arrays and state if not exists
            if (node.pauseType === "rate" && !node.sentTimestamps) {
                node.sentTimestamps = [];
            }

            let currentTimestamps;
            let currentBurstCredits;
            let currentLastSentTime;

            if (node.pauseType === "topic") {
                // Initialize per-topic tracking
                if (!node.topicTimestamps.has(msg.topic)) {
                    node.topicTimestamps.set(msg.topic, []);
                    node.topicBurstCredits.set(msg.topic, 0);
                    node.topicLastSentTime.set(msg.topic, now);
                }
                currentTimestamps = node.topicTimestamps.get(msg.topic);
                currentBurstCredits = node.topicBurstCredits.get(msg.topic);
                currentLastSentTime = node.topicLastSentTime.get(msg.topic);
            } else {
                // Use global tracking
                currentTimestamps = node.sentTimestamps;
                currentBurstCredits = node.burstCredits;
                currentLastSentTime = node.lastSentTime;
            }

            // Calculate the base time window
            const baseWindow = node.rate * node.maxTokens;
            const windowStart = now - baseWindow;

            // Update burst credits if burst mode is enabled
            if (node.allowburst && currentLastSentTime) {
                const timeSinceLastMessage = now - currentLastSentTime;
                const newBurstCredits = Math.floor(timeSinceLastMessage / baseWindow);
                if (newBurstCredits > 0) {
                    currentBurstCredits += newBurstCredits;
                    currentLastSentTime = now - (timeSinceLastMessage % baseWindow);

                    if (node.pauseType === "topic") {
                        node.topicBurstCredits.set(msg.topic, currentBurstCredits);
                        node.topicLastSentTime.set(msg.topic, currentLastSentTime);
                    } else {
                        node.burstCredits = currentBurstCredits;
                        node.lastSentTime = currentLastSentTime;
                    }
                }
            }

            // Clean up old timestamps and calculate current usage
            currentTimestamps = currentTimestamps.filter(ts => ts > windowStart);
            const currentWindowMessages = currentTimestamps.length;

            // Update filtered timestamps
            if (node.pauseType === "topic") {
                node.topicTimestamps.set(msg.topic, currentTimestamps);
            } else {
                node.sentTimestamps = currentTimestamps;
            }

            // Calculate if we can send
            let canSend = false;
            if (currentWindowMessages < node.maxTokens) {
                canSend = true;
            } else if (node.allowburst && currentBurstCredits > 0) {
                canSend = true;
            }

            if (canSend) {
                // Send the message and record the timestamp
                currentTimestamps.push(now);

                if (node.pauseType === "topic") {
                    node.topicTimestamps.set(msg.topic, currentTimestamps);
                }

                // If we're using burst credits, decrease them
                if (currentWindowMessages >= node.maxTokens) {
                    currentBurstCredits--;
                    if (node.pauseType === "topic") {
                        node.topicBurstCredits.set(msg.topic, currentBurstCredits);
                    } else {
                        node.burstCredits = currentBurstCredits;
                    }
                }

                if (node.outputs === 2) {
                    send([msg, null]);
                } else {
                    send(msg);
                }

                // Update status to show current message count and burst credits
                let statusText = `${msg.topic}: ${currentTimestamps.length}/${node.maxTokens}`;
                if(node.allowburst) statusText += ` (burst: ${currentBurstCredits})`;

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: statusText
                });
            } else {
                // Message is dropped
                node.droppedMsgs++;
                if (node.outputs === 2) {
                    send([null, msg]);
                }

                let dropStatusText = `${msg.topic}: dropped`;
                if(node.allowburst) dropStatusText += ` (burst: ${currentBurstCredits})`;
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: dropStatusText
                });
            }

            // Handle reset functionality
            if (msg.hasOwnProperty("reset")) {
                if (node.pauseType === "topic") {
                    node.topicTimestamps.clear();
                    node.topicBurstCredits.clear();
                    node.topicLastSentTime.clear();
                } else {
                    node.sentTimestamps = [];
                    node.lastSentTime = now;
                    node.burstCredits = 0;
                }
                node.rate = node.fixedrate;
                node.status({fill:"blue",shape:"ring",text:"reset"});
            }

            done();
        } else {
                // Original queuing behavior for when drop is false
                if (!msg.hasOwnProperty("reset")) {
                    var m = RED.util.cloneMessage(msg);
                    delete m.flush;
                    if (Object.keys(m).length > 1) {
                        if (node.intervalID !== -1) {
                            if (node.allowrate && m.hasOwnProperty("rate") && !isNaN(parseFloat(m.rate)) && node.rate !== m.rate) {
                                node.rate = m.rate;
                                clearInterval(node.intervalID);
                                node.intervalID = setInterval(sendMsgFromBuffer, node.rate);
                            }
                            var max_msgs = maxKeptMsgsCount(node);
                            if ((max_msgs > 0) && (node.buffer.length >= max_msgs)) {
                                node.buffer = [];
                                node.error(RED._("delay.errors.too-many"), m);
                            } else if (msg.toFront === true) {
                                node.buffer.unshift({msg: m, send: send, done: done});
                                node.reportDepth();
                            } else {
                                node.buffer.push({msg: m, send: send, done: done});
                                node.reportDepth();
                            }
                        }
                        else {
                            if (node.allowrate && m.hasOwnProperty("rate") && !isNaN(parseFloat(m.rate))) {
                                node.rate = m.rate;
                            }
                            send(m);
                            node.reportDepth();
                            node.intervalID = setInterval(sendMsgFromBuffer, node.rate);
                            done();
                        }
                    }
                }
    
                if (msg.hasOwnProperty("flush")) {
                    var len = node.buffer.length;
                    if (typeof(msg.flush) == 'number') { 
                        len = Math.min(Math.floor(msg.flush), len); 
                    }
                    if (len === 0) {
                        clearInterval(node.intervalID);
                        node.intervalID = -1;
                    }
                    else {
                        while (len > 0) {
                            const msgInfo = node.buffer.shift();
                            delete msgInfo.msg.flush;
                            delete msgInfo.msg.reset;
                            if (Object.keys(msgInfo.msg).length > 1) {
                                send(msgInfo.msg);
                                msgInfo.done();
                            }
                            len = len - 1;
                        }
                        clearInterval(node.intervalID);
                        node.intervalID = setInterval(sendMsgFromBuffer, node.rate);
                    }
                    node.status({fill:"blue",shape:"dot",text:node.buffer.length});
                    done();
                }
    
                if (msg.hasOwnProperty("reset")) {
                    if (msg.flush === undefined) {
                        if (node.intervalID !== -1) {
                            clearInterval(node.intervalID);
                            node.intervalID = -1;
                        }
                    }
                    node.buffer = [];
                    node.rate = node.fixedrate;
                    node.status({fill:"blue",shape:"ring",text:0});
                    done();
                }
            }
        });

        node.on("close", function() {
            clearInterval(node.intervalID);
            clearTimeout(node.busy);
            node.buffer.forEach((msgInfo) => msgInfo.done());
            node.buffer = [];
            node.status({});
            node.lastSentTime = null;
            node.tokens = node.maxTokens;
        });
    }
    RED.nodes.registerType("ratelimiter",RatelimiterNode);
}
