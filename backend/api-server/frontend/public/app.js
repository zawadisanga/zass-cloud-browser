// app.json - Hii inawezesha "Deploy to Heroku" button
{
  "name": "ZASS Cloud Browser Enterprise",
  "description": "World's best cloud browser hosting platform",
  "repository": "https://github.com/zass/cloud-browser",
  "logo": "https://zass.website/logo.png",
  "keywords": ["browser", "automation", "playwright", "screenshot", "pdf"],
  "env": {
    "REDIS_URL": {
      "description": "Redis URL for caching",
      "required": true
    },
    "MAX_WORKERS": {
      "description": "Maximum browser workers",
      "value": "10",
      "required": false
    }
  },
  "addons": [
    "heroku-redis:mini",
    "bucketeer:hobbyist"
  ],
  "buildpacks": [
    { "url": "heroku/go" },
    { "url": "heroku/nodejs" }
  ],
  "formation": {
    "web": {
      "quantity": 1,
      "size": "performance-m"
    },
    "worker": {
      "quantity": 3,
      "size": "standard-2x"
    },
    "api": {
      "quantity": 1,
      "size": "standard-1x"
    }
  }
}
