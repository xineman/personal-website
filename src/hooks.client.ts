import { dev } from '$app/env';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from '$app/env/public';
import type { HandleClientError } from '@sveltejs/kit/hooks';
import posthog from 'posthog-js';

export function init() {
	if (!PUBLIC_POSTHOG_KEY || !PUBLIC_POSTHOG_HOST) return;

	posthog.init(PUBLIC_POSTHOG_KEY, {
		api_host: PUBLIC_POSTHOG_HOST,
		capture_exceptions: true,
		session_recording: {
			captureCanvas: { recordCanvas: true },
			canvasCapture: {
				maskRegionsFn: (canvas) => canvas.classList.contains('maplibregl-canvas') ? [] : null
			}
		},
		logs: {
			serviceName: 'northcape-cycling-journal',
			environment: dev ? 'development' : 'production'
		}
	});
}

export const handleError: HandleClientError = ({ kind, error }) => {
	if (!PUBLIC_POSTHOG_KEY || !PUBLIC_POSTHOG_HOST) return;
	if (kind === 'unknown' || error.status !== 404) {
		posthog.captureException(error);
	}
};
