# @eikaramba/node-red-ratelimiter
Works exactly like the [official delay node](https://flowfuse.com/node-red/core-nodes/delay/), but it is dropping a message if the limit applies. For example if you use this to check if something is offline, but only want to get a message maximal once per day. But still want to get the message exactly when it happens again (instead of when the rate limit timer is expired e.g. after 24 hours), this is your node!