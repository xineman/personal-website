import { execFileSync } from 'node:child_process';

if (process.env.POSTHOG_CLI_API_KEY) {
	execFileSync(
		'posthog-cli',
		[
			'sourcemap',
			'process',
			'--directory',
			'.svelte-kit/cloudflare/_app/immutable',
			'--release-name',
			'northcape-cycling-journal',
			'--delete-after'
		],
		{ stdio: 'inherit' }
	);
}
