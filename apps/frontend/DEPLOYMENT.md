# Deployment Guide

This guide covers various deployment options for the XRMOD Demiurge Frontend.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Docker Deployment](#docker-deployment)
- [Static Hosting Deployment](#static-hosting-deployment)
- [Traditional Server Deployment](#traditional-server-deployment)
- [Production Checklist](#production-checklist)
- [Monitoring and Maintenance](#monitoring-and-maintenance)

## Prerequisites

Before deploying, ensure you have:

- Built and tested the application locally
- Configured environment variables for production
- Backend API server deployed and accessible
- SSL certificates (for HTTPS) if deploying to production

## Environment Configuration

### 1. Create Production Environment File

Copy `.env.example` to `.env.production`:

```bash
cp .env.example .env.production
```

### 2. Update Production Variables

Edit `.env.production` with your production values:

```env
# Production API endpoints
VITE_API_BASE_URL=https://api.your-domain.com
VITE_API_AUTH_TOKEN=your-shared-token
VITE_WS_BASE_URL=wss://api.your-domain.com

# Feature flags
VITE_ENABLE_DEBUG=false
VITE_ENABLE_ANALYTICS=true

# Build mode
VITE_BUILD_MODE=production
```

### 3. Build with Production Environment

```bash
npm run build
```

The build process will use `.env.production` automatically.

## Docker Deployment

### Option 1: Docker Compose (Recommended)

**1. Update docker-compose.yml**

Edit `docker-compose.yml` in the project root and update the build args:

```yaml
services:
  frontend:
    build:
      args:
        VITE_API_BASE_URL: https://api.your-domain.com
        VITE_WS_BASE_URL: wss://api.your-domain.com
```

**2. Build and Start Services**

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f frontend
```

**3. Access the Application**

Open http://localhost:3000 in your browser.

**4. Stop Services**

```bash
docker-compose down
```

### Option 2: Standalone Docker Container

**1. Build the Image**

```bash
cd frontend
docker build \
  --build-arg VITE_API_BASE_URL=https://api.your-domain.com \
  --build-arg VITE_WS_BASE_URL=wss://api.your-domain.com \
  -t demiurge-frontend:latest .
```

**2. Run the Container**

```bash
docker run -d \
  --name demiurge-frontend \
  -p 3000:80 \
  --restart unless-stopped \
  demiurge-frontend:latest
```

**3. Verify Container is Running**

```bash
docker ps
docker logs demiurge-frontend
```

**4. Stop and Remove Container**

```bash
docker stop demiurge-frontend
docker rm demiurge-frontend
```

### Docker Hub Deployment

**1. Tag the Image**

```bash
docker tag demiurge-frontend:latest your-username/demiurge-frontend:latest
```

**2. Push to Docker Hub**

```bash
docker login
docker push your-username/demiurge-frontend:latest
```

**3. Pull and Run on Production Server**

```bash
docker pull your-username/demiurge-frontend:latest
docker run -d -p 80:80 your-username/demiurge-frontend:latest
```

## Static Hosting Deployment

### Vercel

**1. Install Vercel CLI**

```bash
npm install -g vercel
```

**2. Deploy**

```bash
cd frontend
vercel --prod
```

**3. Configure Environment Variables**

In Vercel dashboard:
- Go to Project Settings → Environment Variables
- Add `VITE_API_BASE_URL` and `VITE_WS_BASE_URL`

### Netlify

**1. Install Netlify CLI**

```bash
npm install -g netlify-cli
```

**2. Deploy**

```bash
cd frontend
npm run build
netlify deploy --prod --dir=dist
```

**3. Configure Environment Variables**

In Netlify dashboard:
- Go to Site Settings → Build & Deploy → Environment
- Add environment variables

### AWS S3 + CloudFront

**1. Build the Application**

```bash
npm run build
```

**2. Create S3 Bucket**

```bash
aws s3 mb s3://your-bucket-name
```

**3. Configure Bucket for Static Website Hosting**

```bash
aws s3 website s3://your-bucket-name \
  --index-document index.html \
  --error-document index.html
```

**4. Upload Files**

```bash
aws s3 sync dist/ s3://your-bucket-name --delete
```

**5. Create CloudFront Distribution**

- Point origin to S3 bucket
- Configure custom error responses (404 → /index.html)
- Enable HTTPS with SSL certificate

**6. Invalidate CloudFront Cache (after updates)**

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

### GitHub Pages

**1. Install gh-pages**

```bash
npm install --save-dev gh-pages
```

**2. Add Deploy Script to package.json**

```json
{
  "scripts": {
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

**3. Deploy**

```bash
npm run deploy
```

**4. Configure GitHub Pages**

- Go to repository Settings → Pages
- Select `gh-pages` branch
- Save

## Traditional Server Deployment

### Nginx

**1. Build the Application**

```bash
npm run build
```

**2. Copy Files to Server**

```bash
scp -r dist/* user@server:/var/www/demiurge
```

**3. Configure Nginx**

Create `/etc/nginx/sites-available/demiurge`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/demiurge;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

**4. Enable Site and Restart Nginx**

```bash
sudo ln -s /etc/nginx/sites-available/demiurge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**5. Configure SSL with Let's Encrypt**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Apache

**1. Build and Copy Files**

```bash
npm run build
scp -r dist/* user@server:/var/www/demiurge
```

**2. Create .htaccess**

Create `/var/www/demiurge/.htaccess`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

**3. Configure Virtual Host**

Create `/etc/apache2/sites-available/demiurge.conf`:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    DocumentRoot /var/www/demiurge

    <Directory /var/www/demiurge>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/demiurge-error.log
    CustomLog ${APACHE_LOG_DIR}/demiurge-access.log combined
</VirtualHost>
```

**4. Enable Site and Restart Apache**

```bash
sudo a2ensite demiurge
sudo a2enmod rewrite
sudo systemctl restart apache2
```

## Production Checklist

Before deploying to production, verify:

### Build Configuration
- [ ] Environment variables are set correctly
- [ ] Debug mode is disabled (`VITE_ENABLE_DEBUG=false`)
- [ ] API URLs point to production backend
- [ ] Build completes without errors
- [ ] Bundle size is optimized (check with `npm run build`)

### Security
- [ ] HTTPS is enabled (SSL certificate installed)
- [ ] Security headers are configured (CSP, X-Frame-Options, etc.)
- [ ] CORS is properly configured on backend
- [ ] No sensitive data in client-side code
- [ ] Authentication tokens are stored securely

### Performance
- [ ] Static assets are cached properly
- [ ] Gzip compression is enabled
- [ ] Images are optimized
- [ ] Code splitting is working (check Network tab)
- [ ] Lazy loading is implemented for large components

### Functionality
- [ ] All features work in production environment
- [ ] WebSocket connections are stable
- [ ] API requests succeed
- [ ] Error handling works correctly
- [ ] Responsive design works on all devices

### Monitoring
- [ ] Error tracking is set up (e.g., Sentry)
- [ ] Analytics is configured (if enabled)
- [ ] Server logs are accessible
- [ ] Health checks are configured
- [ ] Backup strategy is in place

## Monitoring and Maintenance

### Health Checks

**Docker Health Check**

The Dockerfile includes a health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1
```

Check health status:

```bash
docker ps
docker inspect --format='{{.State.Health.Status}}' demiurge-frontend
```

**External Monitoring**

Use services like:
- UptimeRobot
- Pingdom
- StatusCake
- AWS CloudWatch

### Log Management

**Docker Logs**

```bash
# View logs
docker logs demiurge-frontend

# Follow logs
docker logs -f demiurge-frontend

# Last 100 lines
docker logs --tail 100 demiurge-frontend
```

**Nginx Logs**

```bash
# Access logs
tail -f /var/log/nginx/access.log

# Error logs
tail -f /var/log/nginx/error.log
```

### Updates and Rollbacks

**Update Application**

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose build frontend
docker-compose up -d frontend
```

**Rollback to Previous Version**

```bash
# List images
docker images

# Run previous version
docker run -d -p 3000:80 demiurge-frontend:previous-tag
```

### Backup Strategy

**Backup Configuration Files**

```bash
# Backup environment files
cp .env.production .env.production.backup

# Backup nginx config
cp nginx.conf nginx.conf.backup

# Backup docker-compose
cp docker-compose.yml docker-compose.yml.backup
```

**Version Control**

- Keep all configuration in Git
- Tag releases: `git tag -a v1.0.0 -m "Release 1.0.0"`
- Push tags: `git push origin --tags`

## Troubleshooting

### Common Issues

**1. White screen after deployment**
- Check browser console for errors
- Verify API URLs are correct
- Check CORS configuration on backend

**2. WebSocket connection fails**
- Verify WebSocket URL uses `wss://` for HTTPS
- Check firewall rules
- Verify backend WebSocket endpoint is accessible

**3. 404 errors on refresh**
- Ensure SPA routing is configured (try_files in Nginx)
- Check .htaccess for Apache
- Verify index.html fallback is set up

**4. Assets not loading**
- Check asset paths in build output
- Verify base URL in vite.config.ts
- Check browser Network tab for 404s

**5. Slow performance**
- Enable gzip compression
- Check bundle size (run `npm run build`)
- Verify CDN is working (if using)
- Check for unnecessary re-renders

### Debug Mode

Enable debug mode temporarily:

```bash
# Rebuild with debug enabled
docker build --build-arg VITE_ENABLE_DEBUG=true -t demiurge-frontend:debug .

# Run debug container
docker run -d -p 3000:80 demiurge-frontend:debug
```

## Support

For deployment issues:
- Check the main README.md
- Review backend documentation
- Create an issue in the repository
- Contact the development team

---

**Happy Deploying! 🚀**
