import { Analytics, type TrackParams } from '@june-so/analytics-node';
import { ComponentSettings, Manager, type MCEvent } from '@managed-components/types';
import UAParser from 'ua-parser-js';
import { isValidHttpUrl } from './utils';
import type { IncomingRequestCfPropertiesGeographicInformation } from '@cloudflare/workers-types/experimental';

const getRequestBodyProperties = (event: MCEvent) => {
	const { client, payload } = event;
	const { browser, os, device } = new UAParser(event.client.userAgent).getResult();

	return {
		ip: client.ip,
		$referrer: client.referer || '$direct',
		$referring_domain: isValidHttpUrl(client.referer) ? new URL(client.referer).host : '$direct',
		$current_url: client.url.href,
		$current_domain: client.url.hostname,
		$current_page_title: client.title,
		$current_url_path: client.url.pathname,
		$current_url_search: client.url.search,
		$current_url_protocol: client.url.protocol,
		$screen_height: client.screenHeight,
		$screen_width: client.screenWidth,
		$browser: browser.name,
		$browser_version: browser.version,
		$os: os.name,
		$device: device.model,
		$gclid: client.url.searchParams.get('gclid'),
		$fbclid: client.url.searchParams.get('fbclid'),
	};
};

export const getTrackEventArgs = (event: MCEvent): TrackParams => {
	const { $sr, $identified_id, event: $event, timestamp, ...customFields } = event.payload;

	const distinctId = event.client.get('distinct_id') ?? crypto.randomUUID();
	// Save just in case
	event.client.set('distinct_id', distinctId);

	return {
		anonymousId: distinctId,
		event: $event,
		properties: customFields,
		timestamp: (event.client.timestamp ? new Date(event.client.timestamp * 1000) : new Date()).toISOString(),
		context: getRequestBodyProperties(event),
	};
};

export default async function (manager: Manager, settings: ComponentSettings) {
	function setupJune() {
		return new Analytics(settings['JUNE_WRITE_KEY'], {
			/**
			 * Flush events automatically after every event
			 * @link https://www.june.so/docs/tracking/server/node-js#flush-events-automatically
			 */
			maxEventsInBatch: 1,
			// Fetch is always available because it's set to required in manifest
			httpClient: (url, init) => manager.fetch(url, init)!,
		});
	}

	async function getServerLocation(identifiedId: string) {
		// Use cache to device id (random uuid) to reduce rate limit issues (Cf rate ttl is 5 min)
		const { postalCode, city, region, metroCode, timezone, country, continent } = (await manager.useCache(`loc_${identifiedId}`, () => manager.fetch(new URL('cf.json', 'https://workers.cloudflare.com'))!.then((response) => response.json()), 5 * 60)) as IncomingRequestCfPropertiesGeographicInformation;

		return { postalCode, city, region, metroCode, timezone, country, continent };
	}

	manager.addEventListener('pageview', async (event) => {
		const { os, device } = new UAParser(event.client.userAgent).getResult();
		const distinctId = event.client.get('distinct_id') ?? crypto.randomUUID();
		// Save just in case
		event.client.set('distinct_id', distinctId);

		await manager.fetch(new URL('sdk/page', 'https://api.june.so'), {
			method: 'POST',
			body: JSON.stringify({
				properties: {
					device,
					ip: event.client.ip,
					os,
					referrer: isValidHttpUrl(event.client.referer) ? new URL(event.client.referer).host : 'direct',
					screen: {
						height: event.client.screenHeight,
						width: event.client.screenWidth,
					},
					timezone: (await getServerLocation(distinctId)).timezone,
					userAgent: event.client.userAgent,
				},
				anonymousId: distinctId,
			}),
		});
	});
	manager.addEventListener('track', async (event) => {
		const args = getTrackEventArgs(event);

		setupJune().track({ ...args, context: { ...args.context, ...(await getServerLocation(args.anonymousId!)) } });
	});
	manager.addEventListener('identify', (event) => {});
	manager.addEventListener('group', (event) => {});
}
