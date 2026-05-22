// backend/go-proxy/main.go
package main

import (
    "crypto/tls"
    "encoding/json"
    "log"
    "net/http"
    "net/http/httputil"
    "net/url"
    "sync"
    "sync/atomic"
    "time"
    "github.com/gorilla/mux"
    "github.com/go-redis/redis/v8"
    "context"
)

type BrowserWorker struct {
    URL   string
    Alive bool
    mutex sync.RWMutex
}

type LoadBalancer struct {
    workers []*BrowserWorker
    current uint64
    redis   *redis.Client
}

func NewLoadBalancer() *LoadBalancer {
    lb := &LoadBalancer{
        workers: []*BrowserWorker{
            {URL: "http://localhost:3001", Alive: true},
            {URL: "http://localhost:3002", Alive: true},
            {URL: "http://localhost:3003", Alive: true},
            {URL: "http://localhost:3004", Alive: true},
            {URL: "http://localhost:3005", Alive: true},
        },
        redis: redis.NewClient(&redis.Options{
            Addr: os.Getenv("REDIS_URL"),
        }),
    }
    go lb.healthCheck()
    return lb
}

func (lb *LoadBalancer) healthCheck() {
    ticker := time.NewTicker(5 * time.Second)
    for range ticker.C {
        for _, w := range lb.workers {
            go func(worker *BrowserWorker) {
                resp, err := http.Get(worker.URL + "/health")
                worker.mutex.Lock()
                worker.Alive = err == nil && resp.StatusCode == 200
                worker.mutex.Unlock()
            }(w)
        }
    }
}

func (lb *LoadBalancer) getNextWorker() *BrowserWorker {
    n := atomic.AddUint64(&lb.current, 1)
    for i := 0; i < len(lb.workers); i++ {
        idx := (int(n) + i) % len(lb.workers)
        worker := lb.workers[idx]
        worker.mutex.RLock()
        alive := worker.Alive
        worker.mutex.RUnlock()
        if alive {
            return worker
        }
    }
    return lb.workers[0]
}

func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Rate limiting based on IP
    ip := r.RemoteAddr
    ctx := context.Background()
    count, _ := lb.redis.Incr(ctx, "rate:"+ip).Result()
    if count > 100 {
        lb.redis.Expire(ctx, "rate:"+ip, time.Minute)
        http.Error(w, "Rate limit exceeded", 429)
        return
    }
    lb.redis.Expire(ctx, "rate:"+ip, time.Minute)

    // Cache check
    cacheKey := "cache:" + r.URL.Query().Get("url")
    cached, _ := lb.redis.Get(ctx, cacheKey).Result()
    if cached != "" {
        w.Header().Set("X-Cache", "HIT")
        w.Write([]byte(cached))
        return
    }

    // Proxy to worker
    worker := lb.getNextWorker()
    remote, _ := url.Parse(worker.URL)
    proxy := httputil.NewSingleHostReverseProxy(remote)
    
    proxy.ModifyResponse = func(resp *http.Response) error {
        if resp.StatusCode == 200 {
            body, _ := io.ReadAll(resp.Body)
            lb.redis.Set(ctx, cacheKey, string(body), 30*time.Minute)
            resp.Body = io.NopCloser(bytes.NewReader(body))
        }
        return nil
    }
    
    w.Header().Set("X-Cache", "MISS")
    w.Header().Set("X-Worker", worker.URL)
    proxy.ServeHTTP(w, r)
}

func main() {
    lb := NewLoadBalancer()
    r := mux.NewRouter()
    r.PathPrefix("/").Handler(lb)
    r.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
        stats := make(map[string]interface{})
        for i, w := range lb.workers {
            w.mutex.RLock()
            stats[string(rune('A'+i))] = w.Alive
            w.mutex.RUnlock()
        }
        json.NewEncoder(w).Encode(stats)
    })
    log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), r))
}
