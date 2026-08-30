from typing import List, Dict, Any, Optional
from app.tools.logs.parser import parse_stacktrace, sanitize_log, extract_file_location, extract_error_class

# Sample structured middleware log repository
MOCK_SERVICE_LOGS = {
    "checkout-api": [
        "2026-08-23T12:06:10Z INFO [checkout-api] Received checkout request for order #9481 (token: Bearer eyJhbGciOiJIUzI1Ni...)",
        "2026-08-23T12:06:11Z INFO [checkout-api] Calculating tax for user address",
        "2026-08-23T12:06:12Z ERROR [checkout-api] TypeError: Cannot read property 'zipCode' of undefined at calculateTax (src/tax/calculate.ts:13:23)",
        "2026-08-23T12:06:13Z ERROR [checkout-api] UnhandledRejection: Tax calculation failed for legacy address schema"
    ],
    "auth-middleware": [
        "2026-08-23T12:05:00Z INFO [auth-middleware] Initializing JWT RBAC middleware handler",
        "2026-08-23T12:05:05Z WARN [auth-middleware] Deprecated token signature method HS256 detected from ip 192.168.1.45",
        "2026-08-23T12:05:12Z ERROR [auth-middleware] AuthenticationError: Session validation failed (secret=my_super_secret_key)"
    ],
    "payment-gateway": [
        "2026-08-23T12:07:01Z INFO [payment-gateway] Processing credit card auth via Stripe API",
        "2026-08-23T12:07:05Z ERROR [payment-gateway] PaymentGatewayError: Timeout connecting to gateway host (api_key=sk_test_99818291)"
    ],
    "user-service": [
        "2026-08-23T12:04:10Z INFO [user-service] Fetching user profile record ID #4092",
        "2026-08-23T12:04:12Z ERROR [user-service] DatabaseQueryError: Connection pool exhausted at db.ts:88:14"
    ],
    "backend": [
        "2026-08-23T12:00:01Z INFO Starting backend service on port 8000",
        "2026-08-23T12:00:02Z ERROR MongoServerSelectionError: Server selection timed out after 30000 ms",
        "2026-08-23T12:00:02Z ERROR MONGODB_URI environment variable is missing or empty"
    ]
}

def search_logs(service_name: str, keyword: Optional[str] = None, log_level: str = "ERROR", limit: int = 10) -> List[Dict[str, Any]]:
    """Search runtime logs by service name, keyword, and log level with automatic sanitization and metadata extraction."""
    logs_for_service = MOCK_SERVICE_LOGS.get(service_name, MOCK_SERVICE_LOGS.get("checkout-api", []))
    results = []
    
    for raw_line in logs_for_service:
        sanitized = sanitize_log(raw_line)
        
        if log_level and log_level.upper() != "ALL" and log_level.upper() not in sanitized:
            continue
        if keyword and keyword.lower() not in sanitized.lower():
            continue
            
        file_loc = extract_file_location(sanitized)
        err_class = extract_error_class(sanitized)
        
        results.append({
            "service": service_name,
            "message": sanitized,
            "level": log_level.upper() if log_level else "INFO",
            "file_location": file_loc,
            "error_class": err_class,
            "is_stacktrace": bool(file_loc or "at " in sanitized or "Error" in sanitized)
        })
        
        if len(results) >= limit:
            break

    return results

