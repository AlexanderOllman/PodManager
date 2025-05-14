import sqlite3
import json
import logging
from typing import Dict, List, Optional
import os

class Database:
    def __init__(self, db_path: str = None):
        # Get database path from environment variable or use default
        self.db_path = db_path or os.environ.get('DB_PATH', 'kubernetes_cache.db')
        self._initialize_database()

    def _initialize_database(self):
        """Initialize the database with required tables."""
        try:
            # Create directory if it doesn't exist
            db_dir = os.path.dirname(self.db_path)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)
            
            with sqlite3.connect(self.db_path) as conn:
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

                # Create environment_metrics table
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS environment_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        total_node_pod_capacity INTEGER,
                        total_node_allocatable_cpu_millicores INTEGER,
                        total_node_allocatable_memory_bytes INTEGER, -- Storing as bytes (BIGINT)
                        total_node_allocatable_gpus INTEGER,
                        cpu_limit_percentage INTEGER,
                        memory_limit_percentage INTEGER
                        -- Add other global environment metrics here if needed in the future
                    )
                ''')
                
                conn.commit()
                logging.info(f"Database initialized successfully at {self.db_path}")
        except Exception as e:
            logging.error(f"Error initializing database: {str(e)}")
            raise

    def update_resource(self, resource_type: str, resources: List[Dict]) -> bool:
        """Update or insert resource data, extracting name/namespace from metadata."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                updated_count = 0
                for resource in resources:
                    metadata = resource.get('metadata', {})
                    namespace = metadata.get('namespace', 'default') # Default if missing, though unlikely for namespaced resources
                    name = metadata.get('name')
                    
                    if not name:
                        logging.warning(f"Skipping resource update due to missing name in metadata: {resource_type} / {namespace}")
                        continue

                    cursor.execute('''
                        INSERT OR REPLACE INTO resources 
                        (resource_type, namespace, name, data, last_updated)
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ''', (
                        resource_type,
                        namespace,
                        name,
                        json.dumps(resource) # Store the full resource dict
                    ))
                    updated_count += 1
                
                conn.commit()
                logging.info(f"Updated/Inserted {updated_count} {resource_type} resources.")
                return True
        except Exception as e:
            logging.error(f"Error updating resources for {resource_type}: {str(e)}")
            return False

    def get_resources(self, resource_type: str, namespace: Optional[str] = None) -> List[Dict]:
        """Retrieve resources from the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                if namespace:
                    cursor.execute('''
                        SELECT data FROM resources 
                        WHERE resource_type = ? AND namespace = ?
                    ''', (resource_type, namespace))
                else:
                    cursor.execute('''
                        SELECT data FROM resources 
                        WHERE resource_type = ?
                    ''', (resource_type,))
                
                results = cursor.fetchall()
                return [json.loads(row[0]) for row in results]
        except Exception as e:
            logging.error(f"Error retrieving resources: {str(e)}")
            return []

    def update_metrics(self, metric_type: str, namespace: str, data: Dict) -> bool:
        """Update or insert metrics data."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                cursor.execute('''
                    INSERT OR REPLACE INTO metrics 
                    (metric_type, namespace, data, last_updated)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ''', (
                    metric_type,
                    namespace,
                    json.dumps(data)
                ))
                
                conn.commit()
                return True
        except Exception as e:
            logging.error(f"Error updating metrics: {str(e)}")
            return False

    def get_metrics(self, metric_type: str, namespace: Optional[str] = None) -> List[Dict]:
        """Retrieve metrics from the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                if namespace:
                    cursor.execute('''
                        SELECT data FROM metrics 
                        WHERE metric_type = ? AND namespace = ?
                    ''', (metric_type, namespace))
                else:
                    cursor.execute('''
                        SELECT data FROM metrics 
                        WHERE metric_type = ?
                    ''', (metric_type,))
                
                results = cursor.fetchall()
                return [json.loads(row[0]) for row in results]
        except Exception as e:
            logging.error(f"Error retrieving metrics: {str(e)}")
            return []

    def update_environment_metrics(self, metrics_data: Dict) -> bool:
        """Update the single row in environment_metrics table with the latest metrics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Delete existing metrics (should only be one row)
                cursor.execute('DELETE FROM environment_metrics')
                
                # Insert the new metrics
                cursor.execute('''
                    INSERT INTO environment_metrics (
                        total_node_pod_capacity,
                        total_node_allocatable_cpu_millicores,
                        total_node_allocatable_memory_bytes,
                        total_node_allocatable_gpus,
                        cpu_limit_percentage,
                        memory_limit_percentage
                        -- timestamp is DEFAULT CURRENT_TIMESTAMP
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    metrics_data.get('total_node_pod_capacity'),
                    metrics_data.get('total_node_allocatable_cpu_millicores'),
                    metrics_data.get('total_node_allocatable_memory_bytes'),
                    metrics_data.get('total_node_allocatable_gpus'),
                    metrics_data.get('cpu_limit_percentage'),
                    metrics_data.get('memory_limit_percentage')
                ))
                conn.commit()
                logging.info("Successfully updated environment metrics.")
                return True
        except Exception as e:
            logging.error(f"Error updating environment_metrics: {str(e)}")
            return False

    def get_latest_environment_metrics(self) -> Optional[Dict]:
        """Retrieve the latest environment metrics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row # Access columns by name
                cursor = conn.cursor()
                cursor.execute('SELECT * FROM environment_metrics ORDER BY timestamp DESC LIMIT 1')
                row = cursor.fetchone()
                if row:
                    return dict(row)
                return None
        except Exception as e:
            logging.error(f"Error retrieving latest environment_metrics: {str(e)}")
            return None

    def clear_old_data(self, days: int = 7):
        """Clear data older than specified number of days."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                cursor.execute('''
                    DELETE FROM resources 
                    WHERE last_updated < datetime('now', ?)
                ''', (f'-{days} days',))
                
                cursor.execute('''
                    DELETE FROM metrics 
                    WHERE last_updated < datetime('now', ?)
                ''', (f'-{days} days',))

                cursor.execute('''
                    DELETE FROM environment_metrics
                    WHERE timestamp < datetime('now', ?)
                ''', (f'-{days} days',))
                
                conn.commit()
                logging.info(f"Cleared data older than {days} days")
        except Exception as e:
            logging.error(f"Error clearing old data: {str(e)}")

# Create a global instance
db = Database() 