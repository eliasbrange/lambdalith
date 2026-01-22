/**
 * Type compatibility tests for custom AWS types.
 * These tests verify that our types in aws-types.ts are assignable to
 * the official @types/aws-lambda types.
 *
 * If this file compiles without errors, the types are compatible.
 */

import type * as Official from 'aws-lambda'
import type * as Custom from './aws-types'

// Type assertion helper - if U is not assignable to T, this will error
type AssertAssignable<T, U extends T> = U

// Verify SQSEvent compatibility
type _SQSEventCompat = AssertAssignable<Official.SQSEvent, Custom.SQSEvent>
type _SQSRecordCompat = AssertAssignable<Official.SQSRecord, Custom.SQSRecord>
type _BatchResponseCompat = AssertAssignable<
	Official.SQSBatchResponse,
	Custom.BatchResponse
>

// Verify SNSEvent compatibility
type _SNSEventCompat = AssertAssignable<Official.SNSEvent, Custom.SNSEvent>
type _SNSEventRecordCompat = AssertAssignable<
	Official.SNSEventRecord,
	Custom.SNSEventRecord
>
type _SNSMessageCompat = AssertAssignable<
	Official.SNSMessage,
	Custom.SNSMessage
>

// Verify EventBridgeEvent compatibility
type _EventBridgeEventCompat = AssertAssignable<
	Official.EventBridgeEvent<string, unknown>,
	Custom.EventBridgeEvent<unknown>
>

// Verify DynamoDB Stream compatibility
type _DynamoDBStreamEventCompat = AssertAssignable<
	Official.DynamoDBStreamEvent,
	Custom.DynamoDBStreamEvent
>
type _DynamoDBRecordCompat = AssertAssignable<
	Official.DynamoDBRecord,
	Custom.DynamoDBRecord
>
type _StreamRecordCompat = AssertAssignable<
	Official.StreamRecord,
	Custom.StreamRecord
>
type _AttributeValueCompat = AssertAssignable<
	Official.AttributeValue,
	Custom.AttributeValue
>

// Verify LambdaContext compatibility (excluding deprecated methods: done, fail, succeed)
type _ContextCompat = AssertAssignable<
	Omit<Official.Context, 'done' | 'fail' | 'succeed'>,
	Custom.LambdaContext
>

// Prevent unused variable warnings
export type {
	_SQSEventCompat,
	_SQSRecordCompat,
	_BatchResponseCompat,
	_SNSEventCompat,
	_SNSEventRecordCompat,
	_SNSMessageCompat,
	_EventBridgeEventCompat,
	_DynamoDBStreamEventCompat,
	_DynamoDBRecordCompat,
	_StreamRecordCompat,
	_AttributeValueCompat,
	_ContextCompat,
}
