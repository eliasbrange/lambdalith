# lambda-router

A lightweight, type-safe event router for AWS Lambda functions. Route SQS, SNS, EventBridge, and DynamoDB Streams events with a fluent API.

## Features

- **Automatic event detection** – Identifies incoming event types without configuration
- **Fluent routing API** – Chain handlers with a clean, readable syntax
- **Per-record processing** – Handles batch events record-by-record with partial failure support
- **Route matching** – Filter by queue name, topic, source/detail-type, or table name
- **Sequential processing** – Optional ordered processing for FIFO queues or when order matters
- **Built-in error handling** – Global error and not-found handlers
- **Zero dependencies** – Only peer dependency is TypeScript (optional)
- **Full TypeScript support** – Strongly typed contexts with auto-completion

## Installation

```bash
npm install lambda-router-poc
```

```bash
pnpm add lambda-router-poc
```

```bash
bun add lambda-router-poc
```

## Quick Start

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

// SQS - catch-all
router.sqs((c) => {
  console.log(c.sqs.body);
});

// SQS - match by queue name
router.sqs({ queueName: 'orders-queue' }, (c) => {
  console.log(c.sqs.body);
});

// SQS - sequential processing (for FIFO or ordered processing)
router.sqs({ queueName: 'orders-queue.fifo', sequential: true }, (c) => {
  console.log(c.sqs.body);
});

// SNS - catch-all
router.sns((c) => {
  console.log(c.sns.body);
});

// SNS - match by topic name
router.sns({ topicName: 'user-events' }, (c) => {
  console.log(c.sns.body);
});

// SNS - sequential processing
router.sns({ topicName: 'ordered-events', sequential: true }, (c) => {
  console.log(c.sns.body);
});

// EventBridge - catch-all
router.event((c) => {
  console.log(c.event.detail);
});

// EventBridge - match by source
router.event({ source: 'myapp.orders' }, (c) => {
  console.log(c.event.detail);
});

// EventBridge - match by source and detail-type
router.event({ source: 'myapp.orders', detailType: 'OrderCreated' }, (c) => {
  console.log(c.event.detail);
});

// DynamoDB Streams - catch-all
router.dynamodb((c) => {
  console.log(c.dynamodb.newImage);
});

// DynamoDB Streams - match by table name
router.dynamodb({ tableName: 'orders' }, (c) => {
  console.log(c.dynamodb.newImage);
});

// DynamoDB Streams - match by table name and event type
router.dynamodb.insert({ tableName: 'orders' }, (c) => {
  console.log(c.dynamodb.newImage);
});

// DynamoDB Streams - sequential processing
router.dynamodb({ tableName: 'orders', sequential: true }, (c) => {
  console.log(c.dynamodb.newImage);
});

// Error handler - called when a handler throws
router.onError((error, c) => {
  console.error(error.message, c.source, c.raw);
});

// Not found handler - called when no route matches
router.notFound((c) => {
  console.warn('Unhandled:', c.source, c.raw);
});

export const handler = router.handler();
```

---

## Route Matching

Routes are matched in registration order – the first matching route wins. Register specific routes before catch-alls:

```typescript
router.sqs({ queueName: 'specific-queue' }, (c) => {});
router.sqs((c) => {});
```

---

## Batch Processing

For SQS and DynamoDB Streams, the router automatically handles partial batch failures. Turn on [ReportBatchItemFailures](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html) on your function to take advantage of this feature.

**Default (parallel):** All records processed concurrently. Failed records reported individually.

**Sequential:** Records processed one at a time. On failure, remaining records marked as failed.

---

## Context Reference

### SQS

| Property | Type | Description |
|----------|------|-------------|
| `c.sqs.queue` | `string` | Queue name (extracted from ARN) |
| `c.sqs.body` | `unknown` | Parsed message body (JSON parsed if valid) |
| `c.sqs.messageId` | `string` | SQS message ID |
| `c.sqs.receiptHandle` | `string` | Receipt handle for deletion |
| `c.sqs.sentTimestamp` | `Date` | When the message was sent |
| `c.sqs.approximateReceiveCount` | `number` | Number of times message was received |
| `c.sqs.messageGroupId` | `string \| undefined` | FIFO message group ID |
| `c.sqs.messageDeduplicationId` | `string \| undefined` | FIFO deduplication ID |
| `c.sqs.attributes` | `Record<string, string>` | Message attributes |
| `c.sqs.attribute(name)` | `string \| undefined` | Get a specific attribute |
| `c.sqs.raw` | `SQSRecord` | Raw AWS SQS record |

### SNS

| Property | Type | Description |
|----------|------|-------------|
| `c.sns.topic` | `string` | Topic name (extracted from ARN) |
| `c.sns.topicArn` | `string` | Full topic ARN |
| `c.sns.body` | `unknown` | Parsed message body (JSON parsed if valid) |
| `c.sns.messageId` | `string` | SNS message ID |
| `c.sns.subject` | `string \| undefined` | Message subject |
| `c.sns.timestamp` | `Date` | When the message was published |
| `c.sns.attributes` | `Record<string, string>` | Message attributes |
| `c.sns.attribute(name)` | `string \| undefined` | Get a specific attribute |
| `c.sns.raw` | `SNSEventRecord` | Raw AWS SNS record |

### EventBridge

| Property | Type | Description |
|----------|------|-------------|
| `c.event.source` | `string` | Event source |
| `c.event.detailType` | `string` | Event detail-type |
| `c.event.detail` | `unknown` | Event detail payload |
| `c.event.id` | `string` | Event ID |
| `c.event.account` | `string` | AWS account ID |
| `c.event.region` | `string` | AWS region |
| `c.event.time` | `Date` | Event timestamp |
| `c.event.resources` | `string[]` | Related resources |
| `c.event.raw` | `EventBridgeEvent` | Raw AWS EventBridge event |

### DynamoDB Streams

| Property | Type | Description |
|----------|------|-------------|
| `c.dynamodb.table` | `string` | Table name (extracted from ARN) |
| `c.dynamodb.eventName` | `'INSERT' \| 'MODIFY' \| 'REMOVE'` | Type of operation |
| `c.dynamodb.keys` | `Record<string, unknown>` | Primary key values (unmarshalled) |
| `c.dynamodb.newImage` | `Record<string, unknown> \| undefined` | New item state (unmarshalled) |
| `c.dynamodb.oldImage` | `Record<string, unknown> \| undefined` | Previous item state (unmarshalled) |
| `c.dynamodb.eventId` | `string` | Stream event ID |
| `c.dynamodb.sequenceNumber` | `string` | Stream sequence number |
| `c.dynamodb.streamArn` | `string` | Stream ARN |
| `c.dynamodb.raw` | `DynamoDBRecord` | Raw AWS DynamoDB record |

### Shared

All handlers have access to:

| Property | Type | Description |
|----------|------|-------------|
| `c.lambdaContext` | `LambdaContext` | AWS Lambda context |
| `c.get(key)` | `<T>(key: string) => T \| undefined` | Get value from key-value store |
| `c.set(key, value)` | `(key: string, value: unknown) => void` | Set value in key-value store |

---

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
