import { GenerateRequest, WorkerReply, failureReply, generateTransfer } from './mapGenerationProtocol';

/**
 * The generation worker's entry, which webpack bundles into a chunk of its
 * own from `spawnMapWorker`: one request, progress as each stage attempt
 * starts, then the map with its buffers transferred, or the error. The work
 * is all in mapGenerationProtocol.ts, which the client's in-process
 * fallback runs too.
 */

/** The parts of a dedicated worker's global scope this uses; tsconfig's lib is DOM's, not WebWorker's. */
interface WorkerScope {
	onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
	postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data }) => {
	try {
		const { map, buffers } = generateTransfer({
			params: data.params,
			replay: data.replay,
			onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
		});
		scope.postMessage({ type: 'done', map }, buffers);
	} catch (error) {
		scope.postMessage(failureReply(error));
	}
};
