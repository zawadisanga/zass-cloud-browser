#!/bin/bash
# scripts/deploy.sh - One command deployment

echo "🚀 ZASS Cloud Browser Deployment"
echo "================================"

# Check if logged into Heroku
heroku whoami > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Please login to Heroku first: heroku login"
    exit 1
fi

# Create app if it doesn't exist
APP_NAME="zass-cloud-browser-$(date +%s)"
echo "Creating Heroku app: $APP_NAME"
heroku create $APP_NAME --region eu

# Add Redis
echo "Adding Redis addon..."
heroku addons:create heroku-redis:mini -a $APP_NAME

# Set environment variables
echo "Setting environment variables..."
heroku config:set MAX_WORKERS=5 -a $APP_NAME
heroku config:set NODE_ENV=production -a $APP_NAME

# Deploy
echo "Deploying code..."
git push heroku main

# Scale dynos
echo "Scaling dynos..."
heroku ps:scale web=1 -a $APP_NAME

# Open app
echo "Opening app..."
heroku open -a $APP_NAME

echo ""
echo "✅ Deployment complete!"
echo "📊 App URL: https://$APP_NAME.herokuapp.com"
echo "📈 Stats: https://$APP_NAME.herokuapp.com/health"
