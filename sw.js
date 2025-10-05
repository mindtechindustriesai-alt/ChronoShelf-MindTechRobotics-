// ChronoShelf Service Worker v3.0
// AI-Powered Inventory Management PWA

const CACHE_NAME = 'chronoshelf-v3.0';
const STATIC_CACHE = 'chronoshelf-static-v3';
const DYNAMIC_CACHE = 'chronoshelf-dynamic-v3';

// Core assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png', 
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png'
];

// API endpoints and dynamic resources
const DYNAMIC_ASSETS = [
  '/api/products',
  '/api/inventory'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('🛠️ ChronoShelf Service Worker installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('📦 Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('✅ Static assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('❌ Cache installation failed:', error);
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 ChronoShelf Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Chrome extensions
  if (event.request.url.startsWith('chrome-extension://')) return;

  // Skip analytics and external APIs
  if (event.request.url.includes('google-analytics') || 
      event.request.url.includes('gtag')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          return cachedResponse;
        }

        // Clone the request because it's a one-time use stream
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest)
          .then((response) => {
            // Check if valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response because it's a one-time use stream
            const responseToCache = response.clone();

            // Cache the new response
            caches.open(DYNAMIC_CACHE)
              .then((cache) => {
                // Only cache same-origin requests
                if (event.request.url.startsWith(self.location.origin)) {
                  cache.put(event.request, responseToCache);
                }
              });

            return response;
          })
          .catch((error) => {
            console.log('🌐 Network request failed, serving fallback:', error);
            
            // For navigation requests, serve offline page
            if (event.request.mode === 'navigate') {
              return caches.match('/');
            }
            
            // For API requests, return empty data
            if (event.request.url.includes('/api/')) {
              return new Response(JSON.stringify({
                error: 'Offline mode',
                message: 'You are currently offline',
                timestamp: new Date().toISOString()
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          });
      })
  );
});

// Background sync for offline data
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  
  if (event.tag === 'background-sync-inventory') {
    event.waitUntil(syncInventoryData());
  }
});

// Periodic sync for updates
self.addEventListener('periodicsync', (event) => {
  console.log('⏰ Periodic sync:', event.tag);
  
  if (event.tag === 'content-update') {
    event.waitUntil(updateContent());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('📢 Push notification received');
  
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'ChronoShelf Notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      {
        action: 'view',
        title: 'View Inventory'
      },
      {
        action: 'dismiss', 
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ChronoShelf', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('👆 Notification clicked:', event.action);
  
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.matchAll({type: 'window'}).then((windowClients) => {
        // Check if window is already open
        for (let client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Helper functions
async function syncInventoryData() {
  try {
    // Get pending operations from IndexedDB
    const db = await openInventoryDB();
    const pendingOps = await getPendingOperations(db);
    
    // Sync with server when online
    for (let op of pendingOps) {
      await syncOperation(op);
      await markOperationSynced(db, op.id);
    }
    
    console.log('✅ Inventory data synced');
  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

async function updateContent() {
  try {
    // Update cache with new content
    const cache = await caches.open(STATIC_CACHE);
    const requests = STATIC_ASSETS.map(url => new Request(url));
    
    const responses = await Promise.all(
      requests.map(request => fetch(request))
    );
    
    await Promise.all(
      responses.map((response, i) => {
        if (response.ok) {
          return cache.put(requests[i], response);
        }
      })
    );
    
    console.log('✅ Content updated');
  } catch (error) {
    console.error('❌ Content update failed:', error);
  }
}

// IndexedDB helper functions (placeholder implementations)
function openInventoryDB() {
  return new Promise((resolve) => {
    // Mock implementation - replace with actual IndexedDB logic
    resolve({});
  });
}

function getPendingOperations(db) {
  return Promise.resolve([]);
}

function syncOperation(operation) {
  return Promise.resolve();
}

function markOperationSynced(db, id) {
  return Promise.resolve();
}

// Error handling and logging
self.addEventListener('error', (event) => {
  console.error('🚨 Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 Service Worker unhandled rejection:', event.reason);
});

console.log('🎯 ChronoShelf Service Worker loaded successfully');