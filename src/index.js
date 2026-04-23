import express from 'express';
import cors from 'cors';
import { ApifyClient } from 'apify-client';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

const apifyToken = process.env.APIFY_TOKEN;
if (!apifyToken) {
    console.error('❌ ERROR: APIFY_TOKEN environment variable is not set!');
    process.exit(1);
}

const apifyClient = new ApifyClient({ token: apifyToken });
console.log('✅ Apify client initialized');

function formatTweets(items) {
    if (!items || items.length === 0) return [];
    return items.map(item => ({
        id: item.id,
        text: item.text || '',
        author: {
            username: item.author?.userName || 'unknown',
            name: item.author?.name || 'Unknown',
            verified: item.author?.isVerified || false,
            followers: item.author?.followers || 0,
            profileImage: item.author?.profileImageUrl || null,
        },
        createdAt: item.createdAt,
        metrics: {
            likes: item.likeCount || 0,
            retweets: item.retweetCount || 0,
            replies: item.replyCount || 0,
            views: item.viewCount || 0,
            quotes: item.quoteCount || 0,
        },
        url: item.url || `https://twitter.com/${item.author?.userName}/status/${item.id}`,
        entities: {
            hashtags: item.entities?.hashtags || [],
            mentions: item.entities?.mentions || [],
            urls: item.entities?.urls || [],
        },
        media: item.media || [],
        isRetweet: item.isRetweet || false,
        isReply: item.isReply || false,
    }));
}

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        service: 'X Info Gap Connector',
        description: 'Free X (Twitter) data API using Apify',
        version: '1.0.0',
        author: '长白',
        cost: '$0/month (vs $100/month X API)',
        endpoints: {
            health: { method: 'GET', path: '/health' },
            search: { method: 'POST', path: '/api/search' },
            user: { method: 'POST', path: '/api/user/:username' },
            batch: { method: 'POST', path: '/api/users/batch' },
        },
        timestamp: new Date().toISOString(),
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.post('/api/search', async (req, res) => {
    try {
        const { query, maxResults = 100, since } = req.body;
        if (!query) {
            return res.status(400).json({ 
                success: false,
                error: 'query parameter is required',
            });
        }

        console.log(`🔍 Searching: "${query}"`);
        let searchQuery = query;
        if (since) searchQuery += ` since:${since}`;

        const input = {
            searchTerms: [searchQuery],
            maxTweets: Math.min(maxResults, 500),
            addUserInfo: true,
        };

        const run = await apifyClient.actor("apify/twitter-scraper").call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        const tweets = formatTweets(items);
        
        console.log(`✅ Found ${tweets.length} tweets`);
        res.json({ success: true, query, count: tweets.length, tweets });
    } catch (error) {
        console.error('❌ Search error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { maxResults = 50 } = req.body;

        console.log(`👤 Fetching @${username}`);
        const input = {
            startUrls: [`https://twitter.com/${username}`],
            maxTweets: Math.min(maxResults, 200),
            addUserInfo: true,
        };

        const run = await apifyClient.actor("apify/twitter-scraper").call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        const tweets = formatTweets(items);
        
        console.log(`✅ Found ${tweets.length} tweets`);
        res.json({ success: true, username, count: tweets.length, tweets });
    } catch (error) {
        console.error(`❌ Error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/users/batch', async (req, res) => {
    try {
        const { usernames, maxPerUser = 20 } = req.body;
        if (!usernames || !Array.isArray(usernames)) {
            return res.status(400).json({ 
                success: false,
                error: 'usernames array is required',
            });
        }

        console.log(`📦 Batch fetching ${usernames.length} users`);
        const results = await Promise.allSettled(
            usernames.map(async (username) => {
                const input = {
                    startUrls: [`https://twitter.com/${username}`],
                    maxTweets: Math.min(maxPerUser, 100),
                    addUserInfo: true,
                };
                const run = await apifyClient.actor("apify/twitter-scraper").call(input);
                const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
                return { username, tweets: formatTweets(items) };
            })
        );

        const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected').map((r, i) => ({ 
            username: usernames[i], 
            error: r.reason.message 
        }));
        const allTweets = successful.flatMap(u => u.tweets);

        console.log(`✅ Total: ${allTweets.length} tweets`);
        res.json({
            success: true,
            count: allTweets.length,
            tweets: allTweets,
            byUser: successful,
            failed: failed.length > 0 ? failed : undefined,
        });
    } catch (error) {
        console.error('❌ Batch error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 X Info Gap Connector running on port ${PORT}`);
});