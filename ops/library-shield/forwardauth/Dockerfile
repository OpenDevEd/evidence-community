FROM nginx:1.30.4-alpine

RUN apk add --no-cache curl jq

COPY default.conf /etc/nginx/conf.d/default.conf
COPY banned-ips.conf /etc/nginx/bot-policy/banned-ips.conf
COPY radar-policy.json radar-bots.snapshot.json render-radar-bots.jq /opt/library-shield/
COPY sync-radar-bots.sh /usr/local/bin/sync-radar-bots.sh
COPY 40-sync-radar-bots.sh /docker-entrypoint.d/40-sync-radar-bots.sh

RUN chmod 0755 /usr/local/bin/sync-radar-bots.sh /docker-entrypoint.d/40-sync-radar-bots.sh \
	&& /usr/local/bin/sync-radar-bots.sh \
		--source /opt/library-shield/radar-bots.snapshot.json \
		--policy /opt/library-shield/radar-policy.json \
		--renderer /opt/library-shield/render-radar-bots.jq \
		--output /etc/nginx/conf.d/10-radar-bots.conf

EXPOSE 8080
