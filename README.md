# Lambda Event Router

A lightweight, type-safe event router for AWS Lambda functions. Route SQS, SNS, EventBridge, and DynamoDB Streams events with a fluent API.

## Features

- **Automatic event detection** – Identifies incoming event types without configuration
- **Per-record processing** – Handles batch events record-by-record with partial failure support
- **Route matching** – Filter by queue name, topic, source/detail-type, or table name
- **Sequential processing** – Optional ordered processing for FIFO queues
- **Built-in error handling** – Global error and not-found handlers
- **Zero dependencies** – Only peer dependency is TypeScript (optional)
- **Full TypeScript support** – Strongly typed contexts with auto-completion

## Installation

```bash
npm install lambda-router-poc
```

## Quick Start

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

router.sqs({ queueName: 'orders-queue' }, (c) => {
  console.log(c.sqs.body);
});

router.sns({ topicName: 'user-events' }, (c) => {
  console.log(c.sns.body);
});

router.event({ source: 'myapp.orders', detailType: 'OrderCreated' }, (c) => {
  console.log(c.event.detail);
});

router.dynamodb.insert({ tableName: 'orders' }, (c) => {
  console.log(c.dynamodb.newImage);
});

router.onError((error, c) => {
  console.error(error.message);
});

router.notFound((c) => {
  console.warn('Unhandled:', c.source);
});

export const handler = router.handler();
```


## Route Matching

Routes are matched in registration order – the first matching route wins. Register specific routes before catch-alls:

```typescript
router.sqs({ queueName: 'specific-queue' }, (c) => {
  // will match the specific queue
});
router.sqs((c) => {
  // will match any other queue
});
```

## Batch Processing

For SQS and DynamoDB Streams, the router automatically handles partial batch failures. Enable [ReportBatchItemFailures](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html) on your function to take advantage of this feature.

**Default (parallel):** All records processed concurrently. Failed records reported individually.

**Sequential:** Records processed one at a time. Stops processing on failure and marks remaining records as failed.

```typescript
router.sqs({ queueName: "my-queue", sequential: true }, (c) => {
  // will process messages from my-queue sequentially
});
```

## Context

Each handler receives a context object with event-specific data and the Lambda context:

```typescript
router.sqs((c) => {
  c.sqs         // SQS context
  c.lambda      // Lambda context
});
```

## Error Handling

```typescript
// Called when a handler throws an error
router.onError((error, c) => {
  console.error(error.message);
  console.log(c.source); // 'sqs' | 'sns' | 'event' | 'dynamodb'
  console.log(c.raw);    // Raw event/record
});

// Called when no route matches
router.notFound((c) => {
  console.warn('Unhandled:', c.source);
  console.log(c.raw);
});
```


## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
