# Keep this tag in step with the `playwright` version in package.json: the image ships matching browsers.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]
