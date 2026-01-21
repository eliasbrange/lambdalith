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
	DynamoDBMatchOptions,
	ErrorHandler,
	NotFoundHandler,
	Route,
} from '../types.ts'
import { parseTableName } from '../utils.ts'

export class DynamoDBRouter {
	private routes: Route<DynamoDBHandler, DynamoDBMatchOptions | undefined>[] =
		[]

	add(handler: DynamoDBHandler): void
	add(options: DynamoDBMatchOptions, handler: DynamoDBHandler): void
	add(
		optionsOrHandler: DynamoDBMatchOptions | DynamoDBHandler,
		handler?: DynamoDBHandler,
	): void {
		if (typeof optionsOrHandler === 'function') {
			this.routes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.routes.push({ options: optionsOrHandler, handler })
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

	private matchRoute(
		table: string,
	): Route<DynamoDBHandler, DynamoDBMatchOptions | undefined> | undefined {
		for (const route of this.routes) {
			if (!route.options) {
				return route
			}
			if (!route.options.tableName || route.options.tableName === table) {
				return route
			}
		}
		return undefined
	}
}
