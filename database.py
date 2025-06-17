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
                        total_node_capacity_cpu_millicores INTEGER, -- New
                        total_node_capacity_memory_bytes INTEGER -- New
                        -- cpu_limit_percentage INTEGER, -- Removed
                        -- memory_limit_percentage INTEGER -- Removed
                        -- Add other global environment metrics here if needed in the future
                    )
                ''')
                
                conn.commit()
                logging.info(f"Database initialized successfully at {self.db_path}")
        except Exception as e:
            logging.error(f"Error initializing database: {str(e)}")
            raise

    def update_resources_atomically(self, all_resources: Dict[str, List[Dict]]) -> bool:
        """
        Atomically updates all resources using a staging table and rename strategy.
        This prevents the database from being in an inconsistent state during updates.
        """
        staging_table = 'resources_staging'
        live_table = 'resources'
        old_table = 'resources_old'

        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # 1. Drop any old staging table that might exist from a failed run
                cursor.execute(f'DROP TABLE IF EXISTS {staging_table}')
                cursor.execute(f'DROP TABLE IF EXISTS {old_table}')

                # 2. Create a new staging table
                cursor.execute(f'''
                    CREATE TABLE {staging_table} (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        resource_type TEXT NOT NULL,
                        namespace TEXT NOT NULL,
                        name TEXT NOT NULL,
                        data TEXT NOT NULL,
                        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(resource_type, namespace, name)
                    )
                ''')
                
                # 3. Populate the staging table
                for resource_type, resources_list in all_resources.items():
                    self._update_resource_in_table(cursor, staging_table, resource_type, resources_list)
                
                # 4. Atomically swap the tables
                cursor.execute(f'ALTER TABLE {live_table} RENAME TO {old_table}')
                cursor.execute(f'ALTER TABLE {staging_table} RENAME TO {live_table}')
                
                # 5. Drop the old table
                cursor.execute(f'DROP TABLE {old_table}')
                
                conn.commit()
                logging.info(f"Successfully and atomically updated all resources.")
                return True

        except Exception as e:
            logging.error(f"Error during atomic resource update: {str(e)}", exc_info=True)
            # Attempt to rollback by restoring the old table if it exists
            try:
                with sqlite3.connect(self.db_path) as conn:
                    cursor = conn.cursor()
                    cursor.execute(f'DROP TABLE IF EXISTS {live_table}') # Drop potentially incomplete new table
                    cursor.execute(f'ALTER TABLE {old_table} RENAME TO {live_table}') # Restore backup
                    conn.commit()
                    logging.info("Rolled back to the previous resources table.")
            except Exception as rollback_e:
                logging.error(f"Failed to rollback resources table after an error: {rollback_e}")
            return False

    def _update_resource_in_table(self, cursor, table_name: str, resource_type: str, resources: List[Dict]):
        """
        (Private helper) Update or insert resource data into a specific table.
        This is designed to be called by the atomic update process.
        """
        updated_count = 0
        for resource in resources:
            metadata = resource.get('metadata', {})
            namespace = metadata.get('namespace', 'default')
            name = metadata.get('name')
            
            if not name:
                logging.warning(f"Skipping resource update due to missing name: {resource_type}/{namespace}")
                continue

            cursor.execute(f'''
                INSERT OR REPLACE INTO {table_name}
                (resource_type, namespace, name, data, last_updated)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (
                resource_type,
                namespace,
                name,
                json.dumps(resource)
            ))
            updated_count += 1
        logging.info(f"Updated/Inserted {updated_count} {resource_type} resources into {table_name}.")

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
                        total_node_capacity_cpu_millicores, -- New
                        total_node_capacity_memory_bytes -- New
                        -- cpu_limit_percentage, -- Removed
                        -- memory_limit_percentage -- Removed
                        -- timestamp is DEFAULT CURRENT_TIMESTAMP
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    metrics_data.get('total_node_pod_capacity'),
                    metrics_data.get('total_node_allocatable_cpu_millicores'),
                    metrics_data.get('total_node_allocatable_memory_bytes'),
                    metrics_data.get('total_node_allocatable_gpus'),
                    metrics_data.get('total_node_capacity_cpu_millicores'), # New
                    metrics_data.get('total_node_capacity_memory_bytes')  # New
                    # metrics_data.get('cpu_limit_percentage'), -- Removed
                    # metrics_data.get('memory_limit_percentage') -- Removed
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