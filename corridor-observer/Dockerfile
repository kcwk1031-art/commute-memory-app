FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY . ./
# The reviewed pilot calibration is the only persisted-data seed included in
# the image. Runtime observations and trip records stay outside the image.
COPY data/calibrations/n3-south-xindian-yangmei-lane-calibration.json /app/bootstrap/n3-south-xindian-yangmei-lane-calibration.json

ENV NODE_ENV=production
EXPOSE 10000
CMD ["sh", "start.sh"]
