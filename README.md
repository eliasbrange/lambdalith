# Lambdalith

<img src="./assets/lambdalith.jpg" alt="Lambdalith" />

[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/eliasbrange/lambdalith/ci.yml?branch=main)](https://github.com/eliasbrange/lambdalith/actions)
[![GitHub](https://img.shields.io/github/license/eliasbrange/lambdalith)](https://github.com/eliasbrange/lambdalith/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/lambdalith)](https://www.npmjs.com/package/lambdalith)
[![npm](https://img.shields.io/npm/dm/lambdalith)](https://www.npmjs.com/package/lambdalith)

A lightweight, type-safe event router for AWS Lambda functions. Route SQS, SNS, EventBridge, and DynamoDB Streams events with a fluent API.

## Features

- 🔍 **Automatic event detection** – Identifies incoming event types without configuration.
- 📦 **Per-record processing** – Handles batch events record-by-record in parallel or sequentially with partial failure support.
- 🎯 **Route matching** – Filter by queue name, topic, source/detail-type, or table name.
- ⚠️ **Built-in error handling** – Handle errors and unmatched events with ease.
- 🦺 **Full TypeScript support** – Strongly typed contexts with auto-completion.
- 🔧 **Middleware support** – Run middleware before and after handling each record.
- 🪶 **Lightweight** – Zero dependencies.

## Installation

```bash
npm install lambdalith
```

## Quick Start

```typescript
import { EventRouter } from 'lambdalith';

const router = new EventRouter();

router.sqs('MyQueue', (c) => {
  console.log(c.sqs.body);
});

router.sns('MyTopic', (c) => {
  console.log(c.sns.body);
});

router.event({ source: 'MyService', detailType: 'MyEvent' }, (c) => {
  console.log(c.event.detail);
});

router.dynamodb('MyTable', (c) => {
  console.log(c.dynamodb.newImage);
});

router.onError((error, c) => {
  console.error(error.message);
});

router.notFound((c) => {
  console.warn('Unhandled', c.source);
});

export const handler = router.handler();
```


## Route Matching

Routes are matched in registration order – the first matching route wins. Register specific routes before catch-alls:

```typescript
router.sqs('SpecificQueue', (c) => {
  // will match the specific queue
});
router.sqs((c) => {
  // will match any other queue
});
```

## Batch Processing

For SQS and DynamoDB Streams, the router automatically handles partial batch failures. Enable [ReportBatchItemFailures](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html) on your function to take advantage of this feature.

**Default (parallel):** All records process concurrently. Failed records reported individually.

**Sequential:** Records process one at a time. Stops processing on failure and marks remaining records as failed.

```typescript
router.sqs('MyQueue.fifo', (c) => {
  // will process messages from my-queue sequentially
}, { sequential: true });
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

When an error handler is registered, errors are **swallowed by default**. To propagate an error (mark the record as failed or fail the invocation), rethrow it:

```typescript
// Swallow error (log and continue)
router.onError((error, c) => {
  console.error(error.message);
});

// Propagate error (rethrow to fail)
router.onError((error, c) => {
  console.error(error.message);
  throw error; // Record marked as failed / invocation fails
});
```

If you do not register an error handler, errors always propagate to the router which will mark the record as failed.


```typescript
// Called when no route matches
router.notFound((c) => {
  console.warn('Unhandled:', c.source);
  console.log(c.raw);
});
```

## Middleware

Middleware runs for each record in onion-style order. The first registered middleware wraps the last:

```
middleware1
    middleware2
        handler
    middleware2
middleware1
```

Add a middleware to the router:

```typescript
router.use(async (c, next) => {
  console.log('before');
  await next();
  console.log('after');
});
```

Filter middleware by event type:

```typescript
router.use('sqs', async (c, next) => {
  // Only runs for SQS events
  await next();
});

router.use('sns', snsMiddleware);
router.use('event', eventBridgeMiddleware);
router.use('dynamodb', dynamodbMiddleware);
```

If `next()` is not called, processing auto-continues to the next middleware/handler.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
