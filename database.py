import sqlite3
import json
import os
import logging
import threading
import time
from datetime import datetime
from contextlib import contextmanager

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database setup
DATABASE_PATH = 'k8s_resources.db'
db_lock = threading.Lock()

def init_db():
    """Initialize the database with required tables"""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Resources table for storing all k8s resources
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS resources (
            id TEXT PRIMARY KEY,
            resource_type TEXT,
            namespace TEXT,
            name TEXT,
            yaml TEXT,
            data TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        ''')
        
        # Metadata table for storing last update times
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        ''')
        
        # Namespace metrics table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS namespace_metrics (
            namespace TEXT,
            metric_type TEXT,
            used REAL,
            total REAL,
            updated_at TEXT,
            PRIMARY KEY (namespace, metric_type)
        )
        ''')
        
        conn.commit()
        logging.info("Database initialized")

def clear_db():
    """Clear all data from the database while preserving the structure"""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Begin transaction
        cursor.execute("BEGIN TRANSACTION")
        
        try:
            # Clear all tables
            cursor.execute("DELETE FROM resources")
            cursor.execute("DELETE FROM metadata")
            cursor.execute("DELETE FROM namespace_metrics")
            
            conn.commit()
            logging.info("Database cleared successfully")
            return True
        except Exception as e:
            conn.rollback()
            logging.error(f"Error clearing database: {str(e)}")
            return False

@contextmanager
def get_connection():
    """Get a database connection with lock to prevent concurrent writes"""
    with db_lock:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

class Database:
    def __init__(self):
        if not os.path.exists(DATABASE_PATH):
            init_db()
    
    def update_resource(self, resource_type, items):
        """Update resources in the database from a list of items"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Begin transaction
            cursor.execute("BEGIN TRANSACTION")
            
            try:
                # Delete existing resources of this type
                cursor.execute("DELETE FROM resources WHERE resource_type = ?", (resource_type,))
                
                # Insert new resources
                for resource in items:
                    resource_id = f"{resource_type}:{resource.get('metadata', {}).get('namespace', 'default')}:{resource.get('metadata', {}).get('name', '')}"
                    namespace = resource.get('metadata', {}).get('namespace', 'default')
                    name = resource.get('metadata', {}).get('name', '')
                    yaml_data = json.dumps(resource)  # Store full resource as JSON
                    
                    # Extract simplified data for quick access
                    simplified_data = {
                        'name': name,
                        'namespace': namespace,
                        'status': self._extract_status(resource, resource_type),
                        'created': resource.get('metadata', {}).get('creationTimestamp', ''),
                        'labels': resource.get('metadata', {}).get('labels', {}),
                        'annotations': resource.get('metadata', {}).get('annotations', {})
                    }
                    
                    # Add resource type specific data
                    if resource_type == 'pods':
                        simplified_data['phase'] = resource.get('status', {}).get('phase', '')
                        simplified_data['containers'] = len(resource.get('spec', {}).get('containers', []))
                        simplified_data['node'] = resource.get('spec', {}).get('nodeName', '')
                        
                        # Check for GPU resources
                        for container in resource.get('spec', {}).get('containers', []):
                            limits = container.get('resources', {}).get('limits', {})
                            if 'nvidia.com/gpu' in limits:
                                simplified_data['gpu'] = limits['nvidia.com/gpu']
                    
                    elif resource_type == 'deployments':
                        simplified_data['replicas'] = resource.get('spec', {}).get('replicas', 0)
                        simplified_data['available'] = resource.get('status', {}).get('availableReplicas', 0)
                    
                    elif resource_type == 'services':
                        simplified_data['type'] = resource.get('spec', {}).get('type', 'ClusterIP')
                        simplified_data['clusterIP'] = resource.get('spec', {}).get('clusterIP', '')
                        # Handle ports
                        ports = resource.get('spec', {}).get('ports', [])
                        simplified_data['ports'] = [{
                            'port': port.get('port'),
                            'protocol': port.get('protocol', 'TCP'),
                            'targetPort': port.get('targetPort')
                        } for port in ports]
                    
                    elif resource_type == 'inferenceservices':
                        simplified_data['model'] = resource.get('spec', {}).get('predictor', {}).get('model', {}).get('modelFormat', {}).get('name', 'unknown')
                        simplified_data['runtime'] = resource.get('spec', {}).get('predictor', {}).get('model', {}).get('runtime', 'unknown')
                        
                    elif resource_type == 'configmaps':
                        simplified_data['data_count'] = len(resource.get('data', {}))
                        
                    elif resource_type == 'secrets':
                        simplified_data['type'] = resource.get('type', 'Opaque')
                        simplified_data['data_count'] = len(resource.get('data', {}))
                    
                    cursor.execute('''
                    INSERT INTO resources (id, resource_type, namespace, name, yaml, data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        resource_id,
                        resource_type,
                        namespace,
                        name,
                        yaml_data,
                        json.dumps(simplified_data),
                        datetime.now().isoformat(),
                        datetime.now().isoformat()
                    ))
                
                # Update last updated timestamp
                now = datetime.now().isoformat()
                cursor.execute('''
                INSERT OR REPLACE INTO metadata (key, value)
                VALUES (?, ?)
                ''', (f"last_updated_{resource_type}", now))
                
                conn.commit()
                logging.info(f"Updated {len(items)} {resource_type} in database")
                return True
            except Exception as e:
                conn.rollback()
                logging.error(f"Failed to update {resource_type}: {str(e)}")
                raise
    
    def update_resources(self, resource_type, resources_json):
        """Update resources in the database from JSON string"""
        try:
            resources = json.loads(resources_json)
            return self.update_resource(resource_type, resources.get('items', []))
        except Exception as e:
            logging.error(f"Failed to parse resources JSON: {str(e)}")
            return False
    
    def _extract_status(self, resource, resource_type):
        """Extract status from a resource based on its type"""
        if resource_type == 'pods':
            return resource.get('status', {}).get('phase', '')
        elif resource_type == 'deployments':
            conditions = resource.get('status', {}).get('conditions', [])
            for condition in conditions:
                if condition.get('type') == 'Available':
                    return 'Available' if condition.get('status') == 'True' else 'NotAvailable'
        return 'Unknown'
    
    def get_resources(self, resource_type, namespace='all', search='', page=1, page_size=50, sort_by=None, sort_desc=False):
        """Get resources from the database with filtering and pagination"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            print(f"[DATABASE] DB Query for {resource_type}, namespace={namespace}, page={page}")
            
            # Base query
            query = "SELECT * FROM resources WHERE resource_type = ?"
            params = [resource_type]
            
            # Add namespace filter if not 'all'
            if namespace != 'all':
                query += " AND namespace = ?"
                params.append(namespace)
            
            # Add search filter if provided
            if search:
                query += " AND (name LIKE ? OR namespace LIKE ? OR data LIKE ?)"
                search_param = f"%{search}%"
                params.extend([search_param, search_param, search_param])
                print(f"[DATABASE] Applying search filter: {search}")
            
            # Count total results
            count_query = f"SELECT COUNT(*) FROM ({query})"
            cursor.execute(count_query, params)
            total_count = cursor.fetchone()[0]
            print(f"[DATABASE] Total count for {resource_type}: {total_count}")
            
            # Add sorting
            if sort_by:
                # For simplicity, we assume sorting on top-level fields in the data JSON
                query += f" ORDER BY json_extract(data, '$.{sort_by}')"
                if sort_desc:
                    query += " DESC"
                else:
                    query += " ASC"
            else:
                # Default sort by namespace and name
                query += " ORDER BY namespace, name"
            
            # Add pagination
            offset = (page - 1) * page_size
            query += " LIMIT ? OFFSET ?"
            params.extend([page_size, offset])
            print(f"[DATABASE] Applying pagination: limit={page_size}, offset={offset}")
            
            # Execute query
            cursor.execute(query, params)
            rows = cursor.fetchall()
            print(f"[DATABASE] Query returned {len(rows)} rows")
            
            # Format results
            items = []
            for row in rows:
                yaml_data = json.loads(row['yaml'])
                
                # Add simplified data to the resource
                yaml_data['_podman_data'] = json.loads(row['data'])
                
                items.append(yaml_data)
            
            # Calculate total pages
            total_pages = (total_count + page_size - 1) // page_size
            
            return {
                'items': items,
                'total': total_count,
                'page': page,
                'page_size': page_size,
                'total_pages': total_pages
            }
    
    def get_last_updated(self, resource_type):
        """Get the last updated timestamp for a resource type"""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM metadata WHERE key = ?", (f"last_updated_{resource_type}",))
            row = cursor.fetchone()
            return row['value'] if row else None
    
    def get_dashboard_metrics(self):
        """Get metrics for the dashboard"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Get resource counts
            metrics = {
                'pods': 0,
                'deployments': 0,
                'services': 0,
                'namespaces': 0,
                'running_pods': 0,
                'failed_pods': 0
            }
            
            # Count all resources by type
            cursor.execute("SELECT resource_type, COUNT(*) FROM resources GROUP BY resource_type")
            for row in cursor.fetchall():
                metrics[row[0]] = row[1]
            
            # Count running pods
            cursor.execute("SELECT COUNT(*) FROM resources WHERE resource_type = 'pods' AND json_extract(data, '$.phase') = 'Running'")
            metrics['running_pods'] = cursor.fetchone()[0]
            
            # Count failed pods
            cursor.execute("SELECT COUNT(*) FROM resources WHERE resource_type = 'pods' AND json_extract(data, '$.phase') IN ('Failed', 'Error')")
            metrics['failed_pods'] = cursor.fetchone()[0]
            
            return metrics
    
    def get_namespaces_list(self):
        """Get a list of all namespaces"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Look for namespaces as resources first
            cursor.execute("""
            SELECT DISTINCT json_extract(data, '$.name') as name, 
                   json_extract(data, '$.created') as created,
                   json_extract(data, '$.status') as status
            FROM resources 
            WHERE resource_type = 'namespaces'
            ORDER BY name
            """)
            
            rows = cursor.fetchall()
            
            # If we have namespaces as resources, return them
            if rows and len(rows) > 0:
                namespaces = []
                for row in rows:
                    namespaces.append({
                        'name': row['name'],
                        'created': row['created'],
                        'status': row['status'] or 'Active',
                    })
                return namespaces
            
            # Otherwise, get distinct namespaces from all resources
            cursor.execute("""
            SELECT DISTINCT namespace
            FROM resources
            WHERE namespace IS NOT NULL AND namespace != ''
            ORDER BY namespace
            """)
            
            rows = cursor.fetchall()
            
            # Format results
            namespaces = []
            for row in rows:
                namespaces.append({
                    'name': row['namespace'],
                    'created': None,
                    'status': 'Active',
                })
            
            return namespaces
    
    def get_gpu_pods(self):
        """Get pods with GPU resources"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Find pods with GPU resources
            cursor.execute("""
            SELECT * FROM resources 
            WHERE resource_type = 'pods' 
            AND json_extract(data, '$.gpu') IS NOT NULL
            ORDER BY namespace, name
            """)
            
            rows = cursor.fetchall()
            
            # Format results
            pods = []
            for row in rows:
                pod_data = json.loads(row['data'])
                pods.append({
                    'namespace': pod_data['namespace'],
                    'name': pod_data['name'],
                    'node': pod_data.get('node', ''),
                    'status': pod_data.get('phase', ''),
                    'gpu': pod_data.get('gpu', '0'),
                    'created': pod_data.get('created', '')
                })
            
            return pods
    
    def update_namespace_metrics(self):
        """Update namespace metrics based on pod resources"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Begin transaction
            cursor.execute("BEGIN TRANSACTION")
            
            try:
                # Clear existing metrics
                cursor.execute("DELETE FROM namespace_metrics")
                
                # Get all namespaces
                cursor.execute("SELECT DISTINCT namespace FROM resources WHERE resource_type = 'namespaces'")
                namespaces = [row[0] for row in cursor.fetchall()]
                
                now = datetime.now().isoformat()
                
                # Calculate GPU usage per namespace
                for namespace in namespaces:
                    # GPU metrics
                    cursor.execute("""
                    SELECT SUM(CAST(json_extract(data, '$.gpu') AS REAL)) AS gpu_used
                    FROM resources
                    WHERE resource_type = 'pods'
                    AND namespace = ?
                    AND json_extract(data, '$.gpu') IS NOT NULL
                    """, (namespace,))
                    
                    row = cursor.fetchone()
                    gpu_used = row[0] if row and row[0] is not None else 0
                    
                    # Insert GPU metrics
                    cursor.execute("""
                    INSERT INTO namespace_metrics (namespace, metric_type, used, total, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, (namespace, 'gpu', gpu_used, 0, now))
                    
                    # TODO: Add CPU and Memory metrics calculation
                    # For now, just insert placeholders
                    cursor.execute("""
                    INSERT INTO namespace_metrics (namespace, metric_type, used, total, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, (namespace, 'cpu', 0, 0, now))
                    
                    cursor.execute("""
                    INSERT INTO namespace_metrics (namespace, metric_type, used, total, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, (namespace, 'memory', 0, 0, now))
                
                conn.commit()
                logging.info(f"Updated namespace metrics for {len(namespaces)} namespaces")
            except Exception as e:
                conn.rollback()
                logging.error(f"Failed to update namespace metrics: {str(e)}")
                raise
    
    def get_namespace_metrics(self, metric_type='gpu'):
        """Get namespace metrics for a specific metric type"""
        with get_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
            SELECT namespace, used, total, updated_at
            FROM namespace_metrics
            WHERE metric_type = ?
            ORDER BY used DESC
            """, (metric_type,))
            
            rows = cursor.fetchall()
            
            # Format results
            metrics = []
            for row in rows:
                metrics.append({
                    'namespace': row['namespace'],
                    'used': row['used'],
                    'total': row['total'],
                    'percentage': (row['used'] / row['total'] * 100) if row['total'] > 0 else 0,
                    'updated_at': row['updated_at']
                })
            
            return metrics

# Singleton instance
_db_instance = None

def get_db():
    """Get the database instance"""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance 