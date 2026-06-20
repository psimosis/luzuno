FROM meet-browser-base:latest

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV CHROME_PROFILE_DIR=/data/chrome-profile

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY start.sh /usr/local/bin/meet-browser-start
RUN chmod +x /usr/local/bin/meet-browser-start

EXPOSE 7900 9223
CMD ["/usr/local/bin/meet-browser-start"]
