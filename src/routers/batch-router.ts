import type { BatchResponse, LambdaContext } from '../aws-types.ts'
import type { ErrorHandler, NotFoundHandler } from '../types.ts'

/**
 * Base interface for routes that support sequential processing options.
 */
export interface BatchRouteOptions {
	sequential?: boolean
}

/**
 * Abstract base class for routers that process batch events (SQS, DynamoDB Streams).
 * Handles sequential vs parallel processing and batch failure reporting.
 */
export abstract class BatchRouter<
	TRecord,
	TRoute extends { options?: BatchRouteOptions | undefined },
> {
	protected routes: TRoute[] = []

	async handle(
		records: TRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<BatchResponse> {
		const firstRecord = records[0]
		const isSequential = this.isSequential(firstRecord)

		const { failures } = isSequential
			? await this.processSequentially(
					records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)
			: await this.processInParallel(
					records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	private isSequential(firstRecord: TRecord | undefined): boolean {
		if (!firstRecord) return false
		const route = this.findRouteForRecord(firstRecord)
		return route?.options?.sequential === true
	}

	private async processSequentially(
		records: TRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<{ failures: string[]; firstError?: unknown }> {
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
			} catch (error) {
				return {
					failures: records.slice(i).map((r) => this.getRecordId(r)),
					firstError: error,
				}
			}
		}
		return { failures: [] }
	}

	private async processInParallel(
		records: TRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<{ failures: string[]; firstError?: unknown }> {
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
		let firstError: unknown
		for (let i = 0; i < results.length; i++) {
			const result = results[i]
			if (result?.status === 'rejected') {
				if (firstError === undefined) {
					firstError = result.reason
				}
				const record = records[i]
				if (record) {
					failures.push(this.getRecordId(record))
				}
			}
		}
		return { failures, firstError }
	}

	/**
	 * Get the unique identifier for a record (used for batch failure reporting).
	 */
	protected abstract getRecordId(record: TRecord): string

	/**
	 * Find the matching route for a record (used for isSequential check).
	 */
	protected abstract findRouteForRecord(record: TRecord): TRoute | undefined

	/**
	 * Process a single record through the router.
	 */
	protected abstract processRecord(
		record: TRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void>
}
