import sqlite3
import os
import logging
from pathlib import Path
import subprocess

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_kubernetes_access():
    """Check if we have access to Kubernetes cluster."""
    try:
        result = subprocess.run(
            ["kubectl", "cluster-info"], 
            capture_output=True, 
            text=True
        )
        return result.returncode == 0
    except Exception:
        return False

def init_database(db_path: str = '/data/kubernetes_cache.db'):
    """Initialize the database with required tables."""
    try:
        # Create directory if it doesn't exist
        db_dir = os.path.dirname(db_path)
        Path(db_dir).mkdir(parents=True, exist_ok=True)
        
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            
            # Create resources table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS resources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    resource_type TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    name TEXT NOT NULL,
                    data TEXT NOT NULL,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(resource_type, namespace, name)
                )
            ''')
            
            # Create metrics table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    metric_type TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    data TEXT NOT NULL,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(metric_type, namespace)
                )
            ''')

            # Create settings table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
            logger.info(f"Database initialized successfully at {db_path}")
            
            # Set permissions to ensure the database is writable
            os.chmod(db_path, 0o666)
            logger.info(f"Set database permissions to 666")

            # Check and store Kubernetes access status
            has_k8s_access = check_kubernetes_access()
            cursor.execute('''
                INSERT OR REPLACE INTO settings (key, value, last_updated)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', ('kubernetes_access', str(has_k8s_access)))
            conn.commit()
            
            logger.info(f"Kubernetes access status: {'Available' if has_k8s_access else 'Not available'}")
            
    except Exception as e:
        logger.error(f"Error initializing database: {str(e)}")
        raise

if __name__ == '__main__':
    # Get database path from environment variable or use default
    db_path = os.environ.get('DB_PATH', '/data/kubernetes_cache.db')
    init_database(db_path) 