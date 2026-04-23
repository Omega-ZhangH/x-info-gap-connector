import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apidojo/tweet-scraper';

if (!APIFY_TOKEN) {
  console.error('ERROR: APIFY_TOKEN environment variable is not set!');
  process.exit(1);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function scrapeTwitter(actorInput) {
  try {
    const actorId = APIFY_ACTOR_ID.replace('/', '~');
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=120`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${APIFY_TOKEN}`
        },
        body: JSON.stringify(actorInput)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Apify API returned ${response.status}: ${errorBody}`);
    }

    return response.json();
  } catch (error) {
    console.error('Apify API error:', error.message);
    throw new Error(`Apify scraping failed: ${error.message}`);
  }
}

function formatTweets(rawData) {
  if (!Array.isArray(rawData)) {
    return [];
  }

  return rawData.map(tweet => ({
    id: tweet.id || tweet.tweetId,
    text: tweet.text || tweet.full_text || '',
    author: {
      username: tweet.author?.userName || tweet.user?.screen_name || 'unknown',
      name: tweet.author?.name || tweet.user?.name || 'Unknown',
      verified: tweet.author?.isVerified || tweet.user?.verified || false,
      followers: tweet.author?.followers || tweet.user?.followers_count || 0
    },
    createdAt: tweet.createdAt || tweet.created_at || new Date().toISOString(),
    metrics: {
      likes: tweet.likeCount || tweet.favorite_count || 0,
      retweets: tweet.retweetCount || tweet.retweet_count || 0,
      replies: tweet.replyCount || tweet.reply_count || 0,
      views: tweet.viewCount || tweet.views || 0
    },
    url: tweet.url || `https://twitter.com/${tweet.author?.userName || 'i'}/status/${tweet.id || ''}`,
    entities: {
      hashtags: tweet.entities?.hashtags?.map(h => h.text) || [],
      mentions: tweet.entities?.user_mentions?.map(m => m.screen_name) || [],
      urls: tweet.entities?.urls?.map(u => u.expanded_url) || []
    }
  }));
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
        note: 'Also available as GET /api/search/:query'
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
async function handleSearch(query, maxResults = 100, since = null) {
  if (!query) {
    throw new Error('Query parameter is required');
  }

  const actorInput = {
    searchTerms: [query],
    maxItems: maxResults,
    ...(since && { start: since })
  };

  const rawData = await scrapeTwitter(actorInput);
  const tweets = formatTweets(rawData);

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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✨ NEW: GET endpoint
app.get('/api/search/:query', async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const maxResults = parseInt(req.query.maxResults) || 100;
    const since = req.query.since || null;
    
    const result = await handleSearch(query, maxResults, since);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
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
