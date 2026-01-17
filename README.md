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

router.sqs((c) => {
  console.log('SQS message:', c.sqs.body);
});

router.sns((c) => {
  console.log('SNS message:', c.sns.body);
});

router.event((c) => {
  console.log('EventBridge event:', c.event.detail);
});

router.dynamodb((c) => {
  console.log('DynamoDB record:', c.dynamodb.newImage);
});

export const handler = router.handler();
```

---

## SQS

### Basic Handler

Handle all SQS messages:

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

router.sqs((c) => {
  console.log('Queue:', c.sqs.queue);
  console.log('Body:', c.sqs.body);
  console.log('Message ID:', c.sqs.messageId);
});

export const handler = router.handler();
```

### Route by Queue Name

Handle messages from a specific queue:

```typescript
const router = new EventRouter();

router.sqs({ queueName: 'orders-queue' }, (c) => {
  console.log('Order received:', c.sqs.body);
});

router.sqs({ queueName: 'notifications-queue' }, (c) => {
  console.log('Notification:', c.sqs.body);
});

// Catch-all for unmatched queues
router.sqs((c) => {
  console.log('Other message:', c.sqs.body);
});
```

### Sequential Processing

Process messages in order (for FIFO queues or ordered processing):

```typescript
const router = new EventRouter();

router.sqs({ queueName: 'orders-queue.fifo', sequential: true }, (c) => {
  // Messages processed one at a time, in order
  // On failure, remaining messages are marked as failed
  console.log('Processing order:', c.sqs.body);
});
```

### SQS Context Reference

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
| `c.sqs.attribute(name)` | `(name: string) => string \| undefined` | Get a specific attribute |
| `c.sqs.raw` | `SQSRecord` | Raw AWS SQS record |

---

## SNS

### Basic Handler

Handle all SNS messages:

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

router.sns((c) => {
  console.log('Topic:', c.sns.topic);
  console.log('Body:', c.sns.body);
  console.log('Subject:', c.sns.subject);
});

export const handler = router.handler();
```

### Route by Topic Name

Handle messages from a specific topic:

```typescript
const router = new EventRouter();

router.sns({ topicName: 'user-events' }, (c) => {
  console.log('User event:', c.sns.body);
});

router.sns({ topicName: 'system-alerts' }, (c) => {
  console.log('Alert:', c.sns.body);
});

// Catch-all for unmatched topics
router.sns((c) => {
  console.log('Other notification:', c.sns.body);
});
```

### Sequential Processing

Process messages in order:

```typescript
const router = new EventRouter();

router.sns({ topicName: 'ordered-events', sequential: true }, (c) => {
  console.log('Processing in order:', c.sns.body);
});
```

### SNS Context Reference

| Property | Type | Description |
|----------|------|-------------|
| `c.sns.topic` | `string` | Topic name (extracted from ARN) |
| `c.sns.topicArn` | `string` | Full topic ARN |
| `c.sns.body` | `unknown` | Parsed message body (JSON parsed if valid) |
| `c.sns.messageId` | `string` | SNS message ID |
| `c.sns.subject` | `string \| undefined` | Message subject |
| `c.sns.timestamp` | `Date` | When the message was published |
| `c.sns.attributes` | `Record<string, string>` | Message attributes |
| `c.sns.attribute(name)` | `(name: string) => string \| undefined` | Get a specific attribute |
| `c.sns.raw` | `SNSEventRecord` | Raw AWS SNS record |

---

## EventBridge

### Basic Handler

Handle all EventBridge events:

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

router.event((c) => {
  console.log('Source:', c.event.source);
  console.log('Detail Type:', c.event.detailType);
  console.log('Detail:', c.event.detail);
});

export const handler = router.handler();
```

### Route by Source

Handle events from a specific source:

```typescript
const router = new EventRouter();

router.event({ source: 'myapp.orders' }, (c) => {
  console.log('Order event:', c.event.detail);
});

router.event({ source: 'myapp.users' }, (c) => {
  console.log('User event:', c.event.detail);
});
```

### Route by Detail Type

Handle events with a specific detail-type:

```typescript
const router = new EventRouter();

router.event({ detailType: 'OrderCreated' }, (c) => {
  console.log('New order:', c.event.detail);
});

router.event({ detailType: 'OrderShipped' }, (c) => {
  console.log('Order shipped:', c.event.detail);
});
```

### Route by Source and Detail Type

Combine source and detail-type matching:

```typescript
const router = new EventRouter();

router.event({ source: 'myapp.orders', detailType: 'OrderCreated' }, (c) => {
  console.log('New order from orders service:', c.event.detail);
});

router.event({ source: 'myapp.orders', detailType: 'OrderCancelled' }, (c) => {
  console.log('Order cancelled:', c.event.detail);
});

// Catch-all for other order events
router.event({ source: 'myapp.orders' }, (c) => {
  console.log('Other order event:', c.event.detailType);
});
```

### EventBridge Context Reference

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

---

## DynamoDB Streams

### Basic Handler

Handle all DynamoDB stream records:

```typescript
import { EventRouter } from 'lambda-router-poc';

const router = new EventRouter();

router.dynamodb((c) => {
  console.log('Table:', c.dynamodb.table);
  console.log('Event:', c.dynamodb.eventName);
  console.log('Keys:', c.dynamodb.keys);
  console.log('New Image:', c.dynamodb.newImage);
  console.log('Old Image:', c.dynamodb.oldImage);
});

export const handler = router.handler();
```

### Route by Table Name

Handle records from a specific table:

```typescript
const router = new EventRouter();

router.dynamodb({ tableName: 'orders' }, (c) => {
  console.log('Order change:', c.dynamodb.eventName);
});

router.dynamodb({ tableName: 'users' }, (c) => {
  console.log('User change:', c.dynamodb.eventName);
});
```

### Route by Event Type

Handle specific DynamoDB operations using `.insert`, `.modify`, or `.remove`:

```typescript
const router = new EventRouter();

router.dynamodb.insert((c) => {
  console.log('New record:', c.dynamodb.newImage);
});

router.dynamodb.modify((c) => {
  console.log('Updated record:', c.dynamodb.newImage);
  console.log('Previous values:', c.dynamodb.oldImage);
});

router.dynamodb.remove((c) => {
  console.log('Deleted record:', c.dynamodb.oldImage);
});
```

### Route by Table and Event Type

Combine table name and event type matching:

```typescript
const router = new EventRouter();

router.dynamodb.insert({ tableName: 'orders' }, (c) => {
  console.log('New order:', c.dynamodb.newImage);
});

router.dynamodb.modify({ tableName: 'orders' }, (c) => {
  console.log('Order updated:', c.dynamodb.newImage);
});

router.dynamodb.remove({ tableName: 'orders' }, (c) => {
  console.log('Order deleted:', c.dynamodb.keys);
});
```

### Sequential Processing

Process records in order:

```typescript
const router = new EventRouter();

router.dynamodb({ tableName: 'orders', sequential: true }, (c) => {
  // Records processed one at a time, in order
  // On failure, remaining records are marked as failed
  console.log('Processing:', c.dynamodb.eventName);
});
```

### DynamoDB Context Reference

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

---

## Error Handling

### Global Error Handler

Handle errors thrown by any route handler:

```typescript
const router = new EventRouter();

router.sqs((c) => {
  throw new Error('Something went wrong');
});

router.onError((error, c) => {
  console.error('Error occurred:', error.message);
  console.log('Event source:', c.source);
  console.log('Raw event:', c.raw);
  // Error is still re-thrown after handler executes
});
```

### Not Found Handler

Handle events that don't match any registered route:

```typescript
const router = new EventRouter();

router.sqs({ queueName: 'known-queue' }, (c) => {
  console.log('Known queue message');
});

router.notFound((c) => {
  console.warn('Unhandled event from source:', c.source);
  console.log('Raw event:', c.raw);
});
```

---

## Shared Context

All handlers have access to the Lambda context and a key-value store:

```typescript
const router = new EventRouter();

router.sqs((c) => {
  // Access Lambda context
  console.log('Request ID:', c.lambdaContext.awsRequestId);
  console.log('Function name:', c.lambdaContext.functionName);

  // Use key-value store
  c.set('userId', '12345');
  const userId = c.get<string>('userId');
});
```

---

## Route Matching

Routes are matched in registration order – the first matching route wins:

```typescript
const router = new EventRouter();

// Specific routes first
router.sqs({ queueName: 'priority-queue' }, handlePriority);
router.sqs({ queueName: 'orders-queue' }, handleOrders);

// Catch-all last
router.sqs(handleOther);
```

---

## Method Chaining

All router methods return `this`, so you can chain them if preferred:

```typescript
const router = new EventRouter()
  .sqs({ queueName: 'orders' }, handleOrders)
  .sqs({ queueName: 'notifications' }, handleNotifications)
  .onError(handleError)
  .notFound(handleNotFound);

export const handler = router.handler();
```

---

## Batch Processing

For SQS and DynamoDB Streams, the router automatically handles partial batch failures by returning an `SQSBatchResponse` with failed message identifiers. Configure your Lambda function to use this response for automatic retry of failed records.

**Default (parallel):** All records are processed concurrently. Failed records are reported individually.

**Sequential:** Records are processed one at a time. On failure, the current and all remaining records are marked as failed (preserving order guarantees).

---

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
