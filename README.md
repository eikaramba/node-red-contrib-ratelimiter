# @eikaramba/node-red-ratelimiter

A modified version of the [official Node-RED delay node](https://flowfuse.com/node-red/core-nodes/delay/) that implements true rate limiting with immediate message processing. Delay option is completely removed, use the original node for that.

## Key Features

### 1. True Rate Limiting
Unlike the original delay node which queues messages and releases them at fixed intervals, this node:
- Processes messages immediately when they arrive (if within rate limit)
- Drops messages that exceed the rate limit instead of queuing them
- Resets the rate limit counter based on actual message arrival times

### 2. Flexible Rate Configuration
Supports various rate limiting scenarios:
- X messages per second/minute/hour/day
- Custom periods (e.g., 6 messages per 28 hours)
- Configurable through node settings or dynamic msg properties

### 3. Burst Mode (Optional)
New feature that allows accumulation of unused rate limit slots over time (see detailed examples below)

## Use Cases

### Standard Rate Limiting
Perfect for:
- Monitoring systems that need to limit alert frequency
- API integrations with rate limits
- Event throttling where immediate processing is important

Example (1 message per day):
```text
Hour 0: Message A → Sent
Hour 2: Message B → Dropped (within 24h limit)
Hour 25: Message C → Sent (new period)
Hour 79: Message D → Sent (new period)
```


**New: Allow Burst Option**

### Example 1: 3 messages per hour

**Allow Burst: Disabled**
```text
Time 0:00 - Message A → Sent (1/3)
Time 0:10 - Message B → Sent (2/3)
Time 0:20 - Message C → Sent (3/3)
Time 0:30 - Message D → Dropped (limit reached)
Time 1:05 - Message E → Sent (1/3) (new hour started)
Time 1:06 - Message F → Sent (2/3)
Time 1:07 - Message G → Sent (3/3)
Time 1:08 - Message H → Dropped (limit reached)
```

**Allow Burst: Enabled**
```text
Time 0:00 - Message A → Sent (1/3)
Time 0:10 - Message B → Sent (2/3)
Time 0:20 - Message C → Sent (3/3)
Time 0:30 - Message D → Dropped (limit reached)
// No messages for 2 hours
Time 3:00 - Message E → Sent (1/9) (3 hours worth of tokens accumulated)
Time 3:01 - Message F → Sent (2/9)
Time 3:02 - Message G → Sent (3/9)
Time 3:03 - Message H → Sent (4/9)
Time 3:04 - Message I → Sent (5/9)
Time 3:05 - Message J → Sent (6/9)
Time 3:06 - Message K → Sent (7/9)
Time 3:07 - Message L → Sent (8/9)
Time 3:08 - Message M → Sent (9/9)
Time 3:09 - Message N → Dropped (limit reached)
```

### Example 2: 1 message per day

**Allow Burst: Disabled**
```text
Day 1 10:00 - Message A → Sent
Day 1 14:00 - Message B → Dropped
Day 2 08:00 - Message C → Sent
Day 2 20:00 - Message D → Dropped
Day 3 15:00 - Message E → Sent
```

**Allow Burst: Enabled**
```text
Day 1 10:00 - Message A → Sent
Day 1 14:00 - Message B → Dropped
// No messages for 3 days
Day 5 08:00 - Message C → Sent (1/4) (4 days worth of tokens accumulated)
Day 5 08:01 - Message D → Sent (2/4)
Day 5 08:02 - Message E → Sent (3/4)
Day 5 08:03 - Message F → Sent (4/4)
Day 5 08:04 - Message G → Dropped
```

### Example 3: 6 messages per 28 hours

**Allow Burst: Disabled**
```text
Hour 0:00 - Message A → Sent (1/6)
Hour 0:30 - Message B → Sent (2/6)
Hour 1:00 - Message C → Sent (3/6)
Hour 2:00 - Message D → Sent (4/6)
Hour 3:00 - Message E → Sent (5/6)
Hour 4:00 - Message F → Sent (6/6)
Hour 5:00 - Message G → Dropped
Hour 28:00 - Message H → Sent (1/6) (new period started)
Hour 28:30 - Message I → Sent (2/6)
```

**Allow Burst: Enabled**
```text
Hour 0:00 - Message A → Sent (1/6)
Hour 0:30 - Message B → Sent (2/6)
Hour 1:00 - Message C → Sent (3/6)
// No messages for 56 hours (2 periods)
Hour 57:00 - Message D → Sent (1/18) (3 periods worth of tokens)
Hour 57:01 - Message E → Sent (2/18)
Hour 57:02 - Message F → Sent (3/18)
// Can send up to 15 more messages immediately
```

### Key Differences:

1. **Without Allow Burst:**
   - Tokens reset at the start of each period
   - Maximum tokens = rate limit
   - Unused tokens are lost
   - More predictable, steady flow

2. **With Allow Burst:**
   - Unused tokens accumulate over time
   - Maximum tokens = rate limit × elapsed periods
   - Allows "catching up" after quiet periods
   - More flexible, but can cause traffic spikes

### Use Cases:

1. **Allow Burst Enabled:**
   - Batch processing systems that need to catch up after downtime
   - Systems where occasional bursts of messages are acceptable
   - Backup or replication systems that need to sync after disconnections

2. **Allow Burst Disabled:**
   - Systems requiring strict, consistent rate limiting
   - Real-time processing where even distribution is important
   - APIs with strict rate quotas
   - Systems sensitive to traffic spikes