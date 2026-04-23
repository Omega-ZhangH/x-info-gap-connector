import express from 'express';
import { ApifyClient } from 'apify-client';
import 'dotenv/config';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apidojo/twitter-scraper-lite';

if (!APIFY_TOKEN) {
  console.error('ERROR: APIFY_TOKEN environment variable is not set!');
  process.exit(1);
}

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// ============================================
// HELPER FUNCTIONS
// ============================================

async function scrapeTwitter(actorInput) {
  try {
    const run = await apifyClient.actor(APIFY_ACTOR_ID).call(actorInput);
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    return items;
  } catch (error) {
    console.error('Apify API error:', error.message);
    throw new Error(`Apify scraping failed: ${error.message}`);
  }
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function unwrapTweet(item) {
  return firstValue(
    item?.tweet,
    item?.data?.tweet,
    item?.data?.tweetResult?.result,
    item?.tweetResult?.result,
    item?.result,
    item?.item,
    item?.content?.itemContent?.tweet_results?.result,
    item?.itemContent?.tweet_results?.result,
    item
  );
}

function unwrapAuthor(tweet) {
  return firstValue(
    tweet?.author,
    tweet?.user,
    tweet?.core?.user_results?.result,
    tweet?.core?.user_results?.result?.legacy,
    tweet?.user_results?.result,
    tweet?.user_results?.result?.legacy
  );
}

function getAuthorLegacy(author) {
  return author?.legacy || author;
}

function formatTweet(item) {
  const tweet = unwrapTweet(item);
  const tweetLegacy = tweet?.legacy || tweet;
  const author = unwrapAuthor(tweet);
  const authorLegacy = getAuthorLegacy(author);
  const id = firstValue(tweet?.id, tweet?.tweetId, tweet?.rest_id, tweetLegacy?.id_str);
  const username = firstValue(author?.userName, authorLegacy?.screen_name, author?.screen_name);
  const text = firstValue(tweet?.text, tweet?.full_text, tweetLegacy?.full_text, tweetLegacy?.text, '');

  const formatted = {
    id,
    text,
    author: {
      username: username || 'unknown',
      name: firstValue(author?.name, authorLegacy?.name, 'Unknown'),
      verified: Boolean(firstValue(author?.isVerified, authorLegacy?.verified, author?.is_blue_verified, false)),
      followers: firstValue(author?.followers, authorLegacy?.followers_count, author?.followers_count, 0)
    },
    createdAt: firstValue(tweet?.createdAt, tweet?.created_at, tweetLegacy?.created_at, new Date().toISOString()),
    metrics: {
      likes: firstValue(tweet?.likeCount, tweet?.favorite_count, tweetLegacy?.favorite_count, 0),
      retweets: firstValue(tweet?.retweetCount, tweet?.retweet_count, tweetLegacy?.retweet_count, 0),
      replies: firstValue(tweet?.replyCount, tweet?.reply_count, tweetLegacy?.reply_count, 0),
      views: firstValue(tweet?.viewCount, tweet?.views, tweet?.views?.count, 0),
      quotes: firstValue(tweet?.quoteCount, tweet?.quote_count, tweetLegacy?.quote_count, 0)
    },
    url: firstValue(
      tweet?.url,
      tweet?.twitterUrl,
      id && username ? `https://twitter.com/${username}/status/${id}` : undefined
    ),
    entities: {
      hashtags: firstValue(tweet?.entities?.hashtags, tweetLegacy?.entities?.hashtags, []).map(h => h.text || h.tag || h),
      mentions: firstValue(tweet?.entities?.user_mentions, tweetLegacy?.entities?.user_mentions, []).map(m => m.screen_name || m.username || m),
      urls: firstValue(tweet?.entities?.urls, tweetLegacy?.entities?.urls, []).map(u => u.expanded_url || u.url || u)
    }
  };

  const hasTweetData = formatted.id || formatted.text || formatted.author.username !== 'unknown';
  return hasTweetData ? formatted : null;
}

function formatTweets(rawData) {
  if (!Array.isArray(rawData)) {
    return [];
  }

  return rawData.map(formatTweet).filter(Boolean);
}

function getErrorResponse(error) {
  const message = error?.message || 'Unknown error';

  if (message.includes('Monthly usage hard limit exceeded')) {
    return {
      status: 402,
      body: {
        success: false,
        error: 'Apify monthly usage limit exceeded. Update APIFY_TOKEN or increase the Apify plan limit.'
      }
    };
  }

  if (message.includes('user-or-token-not-found')) {
    return {
      status: 401,
      body: {
        success: false,
        error: 'APIFY_TOKEN is invalid or missing access to the selected actor.'
      }
    };
  }

  if (message.includes('record-not-found')) {
    return {
      status: 502,
      body: {
        success: false,
        error: 'Configured Apify actor was not found. Check APIFY_ACTOR_ID.'
      }
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: message
    }
  };
}

// ============================================
// ROOT ENDPOINT (Health Check)
// ============================================

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'X Info Gap Connector',
    description: 'Free X (Twitter) data API using Apify',
    version: '1.0.0',
    author: '长白',
    cost: '$0/month (vs $100/month X API)',
    endpoints: {
      health: {
        method: 'GET',
        path: '/health'
      },
      search: {
        method: 'POST',
        path: '/api/search',
        note: 'Also available as GET /api/search/:query and GET /api/search?query=...'
      },
      user: {
        method: 'POST',
        path: '/api/user/:username',
        note: 'Also available as GET /api/user/:username'
      },
      batch: {
        method: 'POST',
        path: '/api/users/batch'
      }
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// SEARCH ENDPOINTS (POST + GET)
// ============================================

// Core search logic (shared by POST and GET)
async function handleSearch(query, maxResults = 100, since = null, sort = 'Latest') {
  if (!query) {
    throw new Error('Query parameter is required');
  }

  const limit = Math.max(1, parseInt(maxResults) || 100);
  const actorInput = {
    searchTerms: [query],
    sort,
    maxItems: limit,
    ...(since && { start: since })
  };

  const rawData = await scrapeTwitter(actorInput);
  const tweets = formatTweets(rawData).slice(0, limit);

  return {
    success: true,
    count: tweets.length,
    tweets: tweets,
    query: query,
    scrapedAt: new Date().toISOString()
  };
}

// POST endpoint (original)
app.post('/api/search', async (req, res) => {
  try {
    const { query, maxResults = 100, since } = req.body;
    const result = await handleSearch(query, maxResults, since);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// GET endpoint with query parameter, e.g. /api/search?query=openai
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.query;
    const maxResults = parseInt(req.query.maxResults) || 100;
    const since = req.query.since || null;
    const sort = req.query.sort || 'Latest';

    const result = await handleSearch(query, maxResults, since, sort);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// GET endpoint with path parameter, e.g. /api/search/openai
app.get('/api/search/:query', async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const maxResults = parseInt(req.query.maxResults) || 100;
    const since = req.query.since || null;
    const sort = req.query.sort || 'Latest';
    
    const result = await handleSearch(query, maxResults, since, sort);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// ============================================
// USER ENDPOINTS (POST + GET)
// ============================================

// Core user logic (shared by POST and GET)
async function handleUserTweets(username, maxResults = 50) {
  if (!username) {
    throw new Error('Username parameter is required');
  }

  const actorInput = {
    twitterHandles: [username.replace('@', '')],
    maxItems: maxResults
  };

  const rawData = await scrapeTwitter(actorInput);
  const tweets = formatTweets(rawData);

  return {
    success: true,
    username: username,
    count: tweets.length,
    tweets: tweets,
    scrapedAt: new Date().toISOString()
  };
}

// POST endpoint (original)
app.post('/api/user/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const { maxResults = 50 } = req.body;
    
    const result = await handleUserTweets(username, maxResults);
    res.json(result);
  } catch (error) {
    console.error('User tweets error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// ✨ NEW: GET endpoint
app.get('/api/user/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const maxResults = parseInt(req.query.maxResults) || 50;
    
    const result = await handleUserTweets(username, maxResults);
    res.json(result);
  } catch (error) {
    console.error('User tweets error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// ============================================
// BATCH USER ENDPOINT (POST only)
// ============================================

app.post('/api/users/batch', async (req, res) => {
  try {
    const { usernames, maxPerUser = 20 } = req.body;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'usernames array is required'
      });
    }

    const cleanUsernames = usernames.map(u => u.replace('@', ''));

    const actorInput = {
      twitterHandles: cleanUsernames,
      maxItems: maxPerUser * cleanUsernames.length
    };

    const rawData = await scrapeTwitter(actorInput);
    const allTweets = formatTweets(rawData);

    const tweetsByUser = {};
    cleanUsernames.forEach(username => {
      tweetsByUser[username] = allTweets
        .filter(t => t.author.username.toLowerCase() === username.toLowerCase())
        .slice(0, maxPerUser);
    });

    res.json({
      success: true,
      users: cleanUsernames,
      totalTweets: allTweets.length,
      tweetsByUser: tweetsByUser,
      scrapedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Batch user error:', error);
    const errorResponse = getErrorResponse(error);
    res.status(errorResponse.status).json(errorResponse.body);
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`✅ X Info Gap Connector running on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   GET  /                        - Service info`);
  console.log(`   GET  /health                  - Health check`);
  console.log(`   POST /api/search              - Search tweets`);
  console.log(`   GET  /api/search/:query       - Search tweets (GET)`);
  console.log(`   POST /api/user/:username      - Get user tweets`);
  console.log(`   GET  /api/user/:username      - Get user tweets (GET)`);
  console.log(`   POST /api/users/batch         - Batch user tweets`);
  console.log(`🎭 Apify actor: ${APIFY_ACTOR_ID}`);
  console.log(`🔑 Apify token: ${APIFY_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
});
