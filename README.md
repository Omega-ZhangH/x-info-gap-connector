# X Info Gap Connector

Free X (Twitter) data API using Apify - Save $100/month vs official X API

## Features

- Search tweets by keyword
- Get user timelines
- Batch fetch multiple users
- Full engagement metrics
- 5,000 tweets/month on free tier

## Quick Start

1. Deploy to Zeabur
2. Add APIFY_TOKEN environment variable
3. Done!

## Environment Variables

- `APIFY_TOKEN` - Required. Your Apify API token.
- `APIFY_ACTOR_ID` - Optional. Defaults to `apidojo/tweet-scraper`.
- `PORT` - Optional. Zeabur usually provides this automatically.

## API Endpoints

- `POST /api/search` - Search tweets
- `GET /api/search/:query` - Search tweets
- `POST /api/user/:username` - Get user timeline
- `GET /api/user/:username` - Get user timeline
- `POST /api/users/batch` - Batch fetch users

## Cost

$0/month (vs $100/month X API)

## Author

长白
