FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY publish-patterns.sh /usr/local/bin/publish-patterns
RUN chmod +x /usr/local/bin/publish-patterns

ENTRYPOINT ["/usr/local/bin/publish-patterns"]
