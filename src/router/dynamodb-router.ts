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
	DynamoDBContext,
	DynamoDBHandler,
	DynamoDBOptions,
	DynamoDBRoute,
	ErrorHandler,
	Middleware,
	NotFoundHandler,
} from '../types.ts'
import { parseTableName } from '../utils.ts'
import { BatchRouter } from './batch-router.ts'
import { composeMiddleware } from './middleware.ts'

export class DynamoDBRouter extends BatchRouter<DynamoDBRecord, DynamoDBRoute> {
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
				matcher: undefined,
				options: opts,
				handler: tableNameOrHandler,
			})
		} else {
			// add(tableName, handler) or add(tableName, handler, options)
			this.routes.push({
				matcher: tableNameOrHandler,
				options,
				handler: handlerOrOptions as DynamoDBHandler,
			})
		}
	}

	async handleEvent(
		event: DynamoDBStreamEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware<DynamoDBContext>[] = [],
	): Promise<BatchResponse> {
		return this.handle(
			event.Records,
			lambdaContext,
			errorHandler,
			notFoundHandler,
			middleware as Middleware[],
		)
	}

	protected getRecordId(record: DynamoDBRecord): string {
		return record.eventID
	}

	protected findRouteForRecord(
		record: DynamoDBRecord,
	): DynamoDBRoute | undefined {
		const table = parseTableName(record.eventSourceARN)
		return this.matchRoute(table)
	}

	protected async processRecord(
		record: DynamoDBRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware[] = [],
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
			const composed = composeMiddleware(
				middleware as Middleware<DynamoDBContext>[],
				route.handler,
			)
			await composed(ctx)
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
			if (!route.matcher || route.matcher === table) {
				return route
			}
		}
		return undefined
	}
}
