import type {
	BatchResponse,
	DynamoDBRecord,
	DynamoDBStreamEvent,
	LambdaContext,
} from '../aws-types.ts'
import {
	createDynamoDBContext,
	createErrorContext,
	createNotFoundContext,
} from '../contexts.ts'
import type {
	DynamoDBHandler,
	DynamoDBOptions,
	ErrorHandler,
	NotFoundHandler,
} from '../types.ts'
import { parseTableName } from '../utils.ts'

interface DynamoDBRoute {
	tableName: string | undefined
	options: DynamoDBOptions | undefined
	handler: DynamoDBHandler
}

export class DynamoDBRouter {
	private routes: DynamoDBRoute[] = []

	add(handler: DynamoDBHandler): void
	add(handler: DynamoDBHandler, options: DynamoDBOptions): void
	add(tableName: string, handler: DynamoDBHandler): void
	add(
		tableName: string,
		handler: DynamoDBHandler,
		options: DynamoDBOptions,
	): void
	add(
		tableNameOrHandler: string | DynamoDBHandler,
		handlerOrOptions?: DynamoDBHandler | DynamoDBOptions,
		options?: DynamoDBOptions,
	): void {
		if (typeof tableNameOrHandler === 'function') {
			// add(handler) or add(handler, options)
			const opts =
				typeof handlerOrOptions === 'object' ? handlerOrOptions : undefined
			this.routes.push({
				tableName: undefined,
				options: opts,
				handler: tableNameOrHandler,
			})
		} else {
			// add(tableName, handler) or add(tableName, handler, options)
			this.routes.push({
				tableName: tableNameOrHandler,
				options,
				handler: handlerOrOptions as DynamoDBHandler,
			})
		}
	}

	async handle(
		event: DynamoDBStreamEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<BatchResponse> {
		const firstRecord = event.Records[0]
		const isSequential = this.isSequential(firstRecord)

		const failures = isSequential
			? await this.processSequentially(
					event.Records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)
			: await this.processInParallel(
					event.Records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	private isSequential(firstRecord: DynamoDBRecord | undefined): boolean {
		if (!firstRecord) return false
		const table = parseTableName(firstRecord.eventSourceARN)
		const route = this.matchRoute(table)
		return route?.options?.sequential === true
	}

	private async processSequentially(
		records: DynamoDBRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<string[]> {
		for (let i = 0; i < records.length; i++) {
			const record = records[i]
			if (!record) continue
			try {
				await this.processRecord(
					record,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)
			} catch {
				return records.slice(i).map((r) => r.eventID)
			}
		}
		return []
	}

	private async processInParallel(
		records: DynamoDBRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<string[]> {
		const results = await Promise.allSettled(
			records.map((record) =>
				this.processRecord(
					record,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				),
			),
		)

		const failures: string[] = []
		for (let i = 0; i < results.length; i++) {
			if (results[i]?.status === 'rejected') {
				const record = records[i]
				if (record) {
					failures.push(record.eventID)
				}
			}
		}
		return failures
	}

	private async processRecord(
		record: DynamoDBRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		const table = parseTableName(record.eventSourceARN)
		const route = this.matchRoute(table)

		if (!route) {
			if (notFoundHandler) {
				const ctx = createNotFoundContext('dynamodb', record, lambdaContext)
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const ctx = createDynamoDBContext(record, lambdaContext)
			await route.handler(ctx)
		} catch (error) {
			if (errorHandler) {
				const ctx = createErrorContext('dynamodb', record, lambdaContext)
				await errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private matchRoute(table: string): DynamoDBRoute | undefined {
		for (const route of this.routes) {
			if (!route.tableName || route.tableName === table) {
				return route
			}
		}
		return undefined
	}
}
