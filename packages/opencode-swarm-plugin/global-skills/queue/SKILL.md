---
name: queue
description: "Implements job queue patterns for multi-agent coordination using BullMQ and Redis. Use when submitting background jobs, configuring retry strategies, setting job priority levels, monitoring queue health metrics, or handling dead-letter failures. Use when deciding between background jobs vs inline execution, creating workers with concurrency settings, chaining dependent jobs, or polling for job completion. Covers queue creation, job submission, worker processing, exponential backoff, graceful degradation, and performance tuning."
tags:
  - queue
  - background-jobs
  - distributed-work
  - job-processing
  - reliability
---

# Queue Skill

Reliable job processing for multi-agent workflows using BullMQ and Redis.

## When to Use Background Jobs (Queue)

Queue jobs when:

- **Long-running operations** (>500ms) - Embedding generation, PDF processing, data analysis
- **Resource-intensive work** - ML inference, image transcoding, complex computations
- **Fault tolerance matters** - Can fail and retry without blocking the caller
- **Scaling needed** - Process multiple jobs in parallel with workers
- **Async is acceptable** - Caller doesn't need immediate result
- **Rate limiting required** - Control throughput with concurrency settings
- **Workflow coordination** - Chain tasks or wait for results asynchronously

## When NOT to Use Background Jobs

Use inline execution when:

- **Sub-100ms operations** - Simple data transforms, validation, cache lookups
- **Need immediate result** - Caller blocks waiting for response
- **No failure handling needed** - Single request, no retry logic
- **Stateless one-shots** - No persistence or monitoring required

## Job Queue API

### Creating a Queue

```typescript
import { createSwarmQueue } from 'swarm-queue';

const queue = createSwarmQueue({
  name: 'embeddings',
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // Start at 2 seconds, exponential backoff
    },
    removeOnComplete: true, // Clean up completed jobs
  },
});
```

### Submitting Jobs

```typescript
// Basic job
const jobId = await queue.addJob('generate-embedding', {
  text: 'Hello, world!',
  model: 'text-embedding-3-small',
});

// With priority (0=urgent, 1=high, 2=normal, 3=low)
const jobId = await queue.addJob(
  'agent-task',
  { agentId: 'worker-1', task: 'analyze' },
  { priority: 1 } // Process before normal jobs
);

// Delayed job (start processing after delay)
const jobId = await queue.addJob(
  'retry-agent',
  { attempt: 2 },
  { delay: 30000 } // Process in 30 seconds
);

// With custom retry strategy
const jobId = await queue.addJob(
  'webhook-call',
  { url: 'https://example.com/webhook' },
  {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s, 2s, 4s, 8s, 16s
    },
  }
);
```

### Checking Job Status

```typescript
// Get job details
const job = await queue.getJob(jobId);
if (job) {
  console.log({
    state: await job.getState(), // 'waiting' | 'active' | 'completed' | 'failed'
    progress: job.progress(), // 0-100
    attempts: job.attemptsMade,
    failedReason: job.failedReason,
  });
}

// Get queue metrics
const metrics = await queue.getMetrics();
console.log(metrics);
// {
//   waiting: 42,    // Jobs queued, not started
//   active: 5,      // Jobs being processed
//   completed: 1000,// Successfully finished
//   failed: 3,      // Failed after retries
//   delayed: 0      // Delayed jobs
// }
```

### Canceling Jobs

```typescript
// Remove a job (works from any state)
await queue.removeJob(jobId);
```

## Creating Workers

Workers process jobs from the queue. Start workers in separate processes or services.

```typescript
import { createWorker } from 'swarm-queue';

const worker = await createWorker(
  {
    queueName: 'embeddings',
    concurrency: 4, // Process 4 jobs in parallel
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  },
  async (job) => {
    try {
      const { text, model } = job.data.payload;

      // Update progress
      job.updateProgress(25);

      // Do the work
      const embedding = await generateEmbedding(text, model);

      job.updateProgress(100);

      // Return result
      return {
        success: true,
        data: { embedding, dimensions: embedding.length },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
);

// Start processing
await worker.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.stop();
  await worker.close();
});
```

## Job Priority Patterns

### Urgent vs Background

```typescript
// Urgent: agent error requiring immediate response
await queue.addJob('notify-coordinator', { error }, { priority: 0 });

// High: task completion from other agents
await queue.addJob('merge-results', { results }, { priority: 1 });

// Normal: progress updates
await queue.addJob('update-metrics', { metrics }, { priority: 2 });

// Low: cleanup, archival
await queue.addJob('cleanup-cache', { cacheKey }, { priority: 3 });
```

### Processing Priority in Workers

BullMQ automatically processes higher priority jobs first:

```typescript
// Queue metrics will show that higher priority jobs are processed first
const metrics = await queue.getMetrics();
console.log(`Urgent jobs waiting: ${metrics.waiting}`);
// Worker will process urgent (priority 0) jobs before normal ones
```

## Failure Handling and Retry Strategies

### Exponential Backoff

```typescript
const jobId = await queue.addJob('api-call', { endpoint: '/data' }, {
  attempts: 4,
  backoff: {
    type: 'exponential',
    delay: 1000, // First retry: 1s, then 2s, 4s, 8s
  },
});
```

Retry timeline: 1s → 2s → 4s → 8s → Failed (moves to dead-letter)

### Fixed Delay

```typescript
const jobId = await queue.addJob('webhook', { url }, {
  attempts: 3,
  backoff: {
    type: 'fixed',
    delay: 5000, // Always wait 5 seconds between retries
  },
});
```

### Dead Letter Pattern

After max retries, jobs fail and are no longer retried:

```typescript
// Monitor failures
const metrics = await queue.getMetrics();
if (metrics.failed > 0) {
  console.warn(`${metrics.failed} jobs have permanently failed`);
  // Log to monitoring, alert on-call, etc.
}
```

## Monitoring and Observability

### Real-Time Metrics

```typescript
const metrics = await queue.getMetrics();

const queueHealth = {
  throughput: metrics.completed, // Total completed
  backlog: metrics.waiting, // Jobs not yet started
  inProgress: metrics.active, // Currently being processed
  failureRate: metrics.failed / (metrics.completed + metrics.failed),
  avgTimeInQueue: null, // Custom tracking needed
};

console.log(`Queue health: ${JSON.stringify(queueHealth, null, 2)}`);
```

### Monitoring Best Practices

1. **Track completion time**: Record when jobs enter and exit the queue
2. **Failure alerts**: Alert when failure rate exceeds threshold
3. **Backlog warnings**: Warn when waiting jobs exceed capacity
4. **Worker health**: Monitor worker process availability
5. **Job timeouts**: Set reasonable timeout expectations per job type

```typescript
// Example: Monitor queue health
setInterval(async () => {
  const metrics = await queue.getMetrics();
  const total = Object.values(metrics).reduce((a, b) => a + b);

  if (metrics.failed > 0.1 * total) {
    console.error('High failure rate detected');
    // Alert monitoring system
  }

  if (metrics.waiting > 1000) {
    console.warn('Large backlog detected - consider scaling workers');
  }
}, 30000);
```

## Common Job Types

### Embedding Generation

```typescript
// Agent submits: Generate embeddings for documents
const jobId = await queue.addJob('generate-embedding', {
  documentId: 'doc-123',
  text: 'Full document text here...',
  model: 'text-embedding-3-small',
}, {
  priority: 2,
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
});

// Worker: Process embedding job
const result = await generateEmbedding(payload.text, payload.model);
```

### PDF Processing

```typescript
// Agent submits: Extract text from PDF
const jobId = await queue.addJob('process-pdf', {
  fileUrl: 'https://example.com/document.pdf',
  pages: [1, 2, 3], // Only extract specific pages
}, {
  priority: 1,
  attempts: 2,
  removeOnComplete: true,
});

// Worker: Long-running PDF processing
const text = await extractPdfText(payload.fileUrl, payload.pages);
```

### Bulk Operations

```typescript
// Agent submits: Process 1000 items in background
const jobId = await queue.addJob('bulk-update', {
  items: largeDataset,
  operation: 'transform',
}, {
  priority: 3, // Low priority, can take time
  attempts: 1, // No retry for bulk (resumability is application-specific)
});

// Worker: Stream-based processing
for (const item of payload.items) {
  await processItem(item);
  job.updateProgress(++processed / payload.items.length * 100);
}
```

## Task Coordination with Queues

### Waiting for Results

Since queue jobs are async, use polling or events for results:

```typescript
// Agent A: Submit job and poll for result
const jobId = await queue.addJob('analyze-data', { data });

// Polling (simple but not ideal for long waits)
let result = null;
const maxAttempts = 60; // 60 * 5sec = 5 minutes
for (let i = 0; i < maxAttempts; i++) {
  const job = await queue.getJob(jobId);
  const state = await job?.getState();

  if (state === 'completed') {
    result = job?.returnvalue;
    break;
  }
  await new Promise(r => setTimeout(r, 5000)); // Wait 5s
}

if (result) {
  console.log('Analysis complete:', result);
} else {
  console.error('Job timeout');
}
```

### Chaining Jobs

```typescript
// Job 1: Generate embeddings
const jobId1 = await queue.addJob('generate-embedding', { text });

// Job 2: After Job 1 completes, compare embeddings
// This is application-level coordination - worker for Job 1 submits Job 2
// Worker:
if (jobResult.success) {
  const jobId2 = await queue.addJob('compare-embeddings', {
    embedding: jobResult.data.embedding,
    compareWith: otherEmbedding,
  });
}
```

## CLI Usage (swarm queue)

The swarm CLI provides queue management commands:

```bash
# Submit a job
swarm queue submit embeddings '{"text":"hello","model":"small"}' --priority 1

# Check job status
swarm queue status embeddings job-id-123

# List queue contents
swarm queue list embeddings --state waiting --limit 10
swarm queue list embeddings --state failed

# Start a worker
swarm worker embeddings --concurrency 4

# Cleanup old jobs
swarm queue cleanup embeddings --before 7d
```

## Error Handling Strategies

### Graceful Degradation

```typescript
// If job fails, provide fallback
const jobId = await queue.addJob('expensive-compute', { data });

try {
  const job = await queue.getJob(jobId);
  const state = await job?.getState();

  if (state === 'failed') {
    // Use fallback result
    return getCachedResult(data) || getDefaultResult();
  }
} catch (error) {
  // Queue unavailable - use fallback
  return getCachedResult(data);
}
```

### Dead Letter Handling

```typescript
// Monitor failed jobs and move to dead-letter handling
const metrics = await queue.getMetrics();
if (metrics.failed > 0) {
  const failedJobs = []; // Fetch failed jobs from Redis
  // Send to dead-letter queue for manual review or retrigger
  for (const job of failedJobs) {
    console.error(`Failed job ${job.id}: ${job.failedReason}`);
    // Log to monitoring system
    // Alert on-call engineer
  }
}
```

## Validation Checkpoints

Before deploying queue-based workflows, verify:

1. **Connection check** - Confirm Redis is reachable and `createSwarmQueue` returns without error
2. **Job submission** - Submit a test job and verify it appears in `getMetrics().waiting`
3. **Worker processing** - Start a worker and confirm the test job transitions to `completed`
4. **Retry behavior** - Submit a failing job and verify retry attempts match `defaultJobOptions.attempts`
5. **Graceful shutdown** - Send SIGTERM and confirm worker drains active jobs before stopping

## Performance Tuning

### Concurrency Settings

```typescript
// Low concurrency: Process fewer jobs in parallel (less resource use)
const worker = await createWorker(
  {
    queueName: 'embeddings',
    concurrency: 1, // One at a time (good for expensive ops)
  },
  processor
);

// High concurrency: More parallel processing (higher throughput)
const worker = await createWorker(
  {
    queueName: 'simple-tasks',
    concurrency: 16, // Max parallel (good for I/O-bound ops)
  },
  processor
);
```

### Job Options for Performance

```typescript
// Remove completed jobs to save Redis memory
await queue.addJob('cleanup', { data }, {
  removeOnComplete: true, // Don't keep history
  attempts: 1, // No retry needed
});

// Keep important jobs for auditing
await queue.addJob('agent-task', { data }, {
  removeOnComplete: false, // Retain history
  attempts: 3, // Retry on failure
});
```

## Testing

### Unit Testing Jobs

```typescript
import { describe, test, expect } from 'bun:test';

describe('Queue Jobs', () => {
  test('embedding job returns valid embedding', async () => {
    const processor = async (job) => {
      // Mock job for testing
      return {
        success: true,
        data: { embedding: [0.1, 0.2, 0.3] },
      };
    };

    const result = await processor({
      data: { payload: { text: 'hello', model: 'small' } },
    });

    expect(result.success).toBe(true);
    expect(result.data.embedding).toHaveLength(3);
  });
});
```

### Integration Testing with Real Queue

```typescript
test('job completes successfully in queue', async () => {
  const queue = createSwarmQueue({ name: 'test-queue' });

  const jobId = await queue.addJob('test-job', { data: 'test' });

  const job = await queue.getJob(jobId);
  expect(job).toBeDefined();

  // Clean up
  await queue.removeJob(jobId);
  await queue.close();
});
```

## Summary

- Use queues for long-running, fault-tolerant work
- Set appropriate priority and retry strategies
- Monitor queue health and failure rates
- Chain jobs at the application level
- Gracefully handle job failures with fallbacks
- Scale workers independently from the API
