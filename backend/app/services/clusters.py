"""Cluster and IP Pool management for ECMP autoscale.

Stores cluster definitions as JSON files in DATA_DIR/clusters/.
Each cluster defines:
- Proxmox connection details (host, token, template VMID)
- BGP parameters (ASN, peer IPs, VIP network)
- IP pool for management and self-IPs
- Active member tracking

Storage pattern matches automations — simple JSON files, no external DB.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = os.getenv("DATA_DIR", "/app/data")
CLUSTERS_DIR = os.path.join(DATA_DIR, "clusters")


def _ensure_dirs():
    os.makedirs(CLUSTERS_DIR, exist_ok=True)


# ── Cluster Schema ─────────────────────────────────────────
#
# {
#   "id": "ecmp-prod-01",
#   "name": "Production ECMP Cluster",
#   "description": "...",
#   "proxmox": {
#     "host": "192.168.1.5",
#     "port": 8006,
#     "node": "pve01",
#     "token_id": "root@pam!insight",
#     "token_secret": "xxx",
#     "template_vmid": 9000,
#     "vmid_range_start": 101,
#     "vmid_range_end": 128,
#     "cores": 4,
#     "memory_mb": 8192
#   },
#   "bgp": {
#     "local_asn": 65001,
#     "remote_asn": 65000,
#     "frr_peer_ip": "10.1.1.1",
#     "frr_ip": "192.168.1.10",
#     "frr_user": "admin",
#     "vip_network": "10.100.1.0/24",
#     "bgp_vlan": 10,
#     "client_vlan": 20
#   },
#   "master": {
#     "hostname": "bigip-master",
#     "mgmt_ip": "192.168.1.20",
#     "self_ip": "10.1.1.10",
#     "user": "admin",
#     "pass": "..."
#   },
#   "license": {
#     "pool_name": "ve-pool-01",
#     "bigiq_host": "192.168.1.30"
#   },
#   "ip_pool": {
#     "mgmt_ips": ["192.168.1.21", ..., "192.168.1.28"],
#     "self_ips": ["10.1.1.11", ..., "10.1.1.18"],
#     "allocated": {
#       "192.168.1.21": {"self_ip": "10.1.1.11", "vmid": 101, "hostname": "..."}
#     }
#   },
#   "members": { "hostname": { ... } },
#   "insight_host": "192.168.1.50",
#   "created_at": "...",
#   "updated_at": "..."
# }


# ── CRUD ───────────────────────────────────────────────────

def list_clusters() -> list[dict]:
    """List all cluster definitions (summary view)."""
    _ensure_dirs()
    clusters = []
    for f in sorted(Path(CLUSTERS_DIR).glob("*.json")):
        try:
            data = json.loads(f.read_text())
            allocated = data.get("ip_pool", {}).get("allocated", {})
            members = data.get("members", {})
            clusters.append({
                "id": data["id"],
                "name": data.get("name", ""),
                "description": data.get("description", ""),
                "proxmox_node": data.get("proxmox", {}).get("node", ""),
                "local_asn": data.get("bgp", {}).get("local_asn", 0),
                "master": data.get("master", {}).get("hostname", ""),
                "pool_total": len(data.get("ip_pool", {}).get("mgmt_ips", [])),
                "pool_allocated": len(allocated),
                "active_members": sum(1 for m in members.values()
                                      if m.get("status") == "active"),
                "created_at": data.get("created_at"),
            })
        except Exception as e:
            logger.warning(f"Failed to parse cluster {f}: {e}")
    return clusters


def get_cluster(cluster_id: str) -> Optional[dict]:
    """Get full cluster definition."""
    _ensure_dirs()
    path = Path(CLUSTERS_DIR) / f"{cluster_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def create_cluster(data: dict) -> dict:
    """Create a new ECMP cluster definition."""
    _ensure_dirs()
    cluster_id = data.get("id") or str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    cluster = {
        "id": cluster_id,
        "name": data.get("name", f"Cluster {cluster_id}"),
        "description": data.get("description", ""),
        "proxmox": data.get("proxmox", {}),
        "bgp": data.get("bgp", {}),
        "master": data.get("master", {}),
        "license": data.get("license", {}),
        "ip_pool": {
            "mgmt_ips": data.get("ip_pool", {}).get("mgmt_ips", []),
            "self_ips": data.get("ip_pool", {}).get("self_ips", []),
            "allocated": data.get("ip_pool", {}).get("allocated", {}),
        },
        "members": data.get("members", {}),
        "insight_host": data.get("insight_host", "192.168.1.50"),
        "created_at": now,
        "updated_at": now,
    }

    path = Path(CLUSTERS_DIR) / f"{cluster_id}.json"
    path.write_text(json.dumps(cluster, indent=2))
    logger.info(f"Created cluster '{cluster['name']}' ({cluster_id})")
    return cluster


def update_cluster(cluster_id: str, data: dict) -> Optional[dict]:
    """Update an existing cluster definition."""
    existing = get_cluster(cluster_id)
    if not existing:
        return None

    for key in ["name", "description", "proxmox", "bgp", "master",
                 "license", "license_pool", "ip_pool", "insight_host"]:
        if key in data:
            existing[key] = data[key]

    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = Path(CLUSTERS_DIR) / f"{cluster_id}.json"
    path.write_text(json.dumps(existing, indent=2))
    return existing


def delete_cluster(cluster_id: str) -> bool:
    """Delete a cluster definition."""
    path = Path(CLUSTERS_DIR) / f"{cluster_id}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def _save_cluster(cluster: dict):
    """Persist cluster state to disk."""
    _ensure_dirs()
    cluster["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = Path(CLUSTERS_DIR) / f"{cluster['id']}.json"
    path.write_text(json.dumps(cluster, indent=2))


# ── IP Pool Management ─────────────────────────────────────

def allocate_ip(cluster_id: str) -> Optional[dict]:
    """Allocate the next available management IP and self-IP pair.

    Returns: {"mgmt_ip": "...", "self_ip": "...", "vmid": N} or None
    """
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pool = cluster.get("ip_pool", {})
    mgmt_ips = pool.get("mgmt_ips", [])
    self_ips = pool.get("self_ips", [])
    allocated = pool.get("allocated", {})

    if len(mgmt_ips) != len(self_ips):
        logger.error(f"Cluster {cluster_id}: mgmt_ips and self_ips length mismatch")
        return None

    # Find first unallocated mgmt IP
    for i, mgmt_ip in enumerate(mgmt_ips):
        if mgmt_ip not in allocated:
            self_ip = self_ips[i]
            # Pick next available VMID
            pve = cluster.get("proxmox", {})
            vmid_start = pve.get("vmid_range_start", 100)
            vmid_end = pve.get("vmid_range_end", 199)
            used_vmids = {v.get("vmid") for v in allocated.values() if v.get("vmid")}
            vmid = None
            for v in range(vmid_start, vmid_end + 1):
                if v not in used_vmids:
                    vmid = v
                    break

            if vmid is None:
                logger.error(f"Cluster {cluster_id}: no VMIDs available")
                return None

            allocation = {
                "self_ip": self_ip,
                "vmid": vmid,
                "allocated_at": datetime.now(timezone.utc).isoformat(),
            }
            allocated[mgmt_ip] = allocation
            pool["allocated"] = allocated
            cluster["ip_pool"] = pool
            _save_cluster(cluster)

            result = {"mgmt_ip": mgmt_ip, "self_ip": self_ip, "vmid": vmid}
            logger.info(f"Allocated {result} from cluster {cluster_id}")
            return result

    logger.warning(f"Cluster {cluster_id}: IP pool exhausted")
    return None


def release_ip(cluster_id: str, mgmt_ip: str = None,
               self_ip: str = None) -> bool:
    """Release an allocated IP pair back to the pool."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return False

    allocated = cluster.get("ip_pool", {}).get("allocated", {})

    # Find by mgmt_ip directly
    if mgmt_ip and mgmt_ip in allocated:
        del allocated[mgmt_ip]
        cluster["ip_pool"]["allocated"] = allocated
        _save_cluster(cluster)
        logger.info(f"Released {mgmt_ip} in cluster {cluster_id}")
        return True

    # Find by self_ip
    if self_ip:
        for m_ip, info in list(allocated.items()):
            if info.get("self_ip") == self_ip:
                del allocated[m_ip]
                cluster["ip_pool"]["allocated"] = allocated
                _save_cluster(cluster)
                logger.info(f"Released {m_ip} (self: {self_ip}) in cluster {cluster_id}")
                return True

    return False


def get_pool_status(cluster_id: str) -> Optional[dict]:
    """Get IP pool allocation status."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pool = cluster.get("ip_pool", {})
    mgmt_ips = pool.get("mgmt_ips", [])
    allocated = pool.get("allocated", {})

    return {
        "total": len(mgmt_ips),
        "allocated": len(allocated),
        "available": len(mgmt_ips) - len(allocated),
        "allocations": allocated,
    }


# ── Member Management ──────────────────────────────────────

def add_member(cluster_id: str, member_data: dict) -> Optional[dict]:
    """Add or update a cluster member."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    hostname = member_data.get("hostname", "")
    if not hostname:
        # Generate hostname from cluster + vmid
        hostname = f"bigip-{cluster_id}-{member_data.get('vmid', 'unknown')}"

    member = {
        "hostname": hostname,
        "vmid": member_data.get("vmid"),
        "mgmt_ip": member_data.get("mgmt_ip"),
        "self_ip": member_data.get("self_ip"),
        "status": member_data.get("status", "provisioning"),
        "joined_at": member_data.get("joined_at"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    cluster.setdefault("members", {})[hostname] = member
    _save_cluster(cluster)
    return member


def remove_member(cluster_id: str, hostname: str) -> bool:
    """Remove a member from the cluster."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return False

    members = cluster.get("members", {})
    if hostname in members:
        del members[hostname]
        cluster["members"] = members
        _save_cluster(cluster)
        return True
    return False


def update_member_status(cluster_id: str, hostname: str,
                         status: str) -> Optional[dict]:
    """Update a member's status."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    member = cluster.get("members", {}).get(hostname)
    if not member:
        return None

    member["status"] = status
    if status == "active" and not member.get("joined_at"):
        member["joined_at"] = datetime.now(timezone.utc).isoformat()
    member["updated_at"] = datetime.now(timezone.utc).isoformat()

    cluster["members"][hostname] = member
    _save_cluster(cluster)
    return member


def get_cluster_params(cluster_id: str) -> Optional[dict]:
    """Flatten cluster config into a params dict for skill template resolution.

    Returns a flat dict that automation chains can use with {{key}} templates:
    - template_vmid, proxmox_node, cores, memory_mb
    - local_asn, remote_asn, frr_peer_ip, frr_ip, frr_user, vip_network
    - master_ip, master_user, master_pass
    - license_pool, bigiq_host
    - insight_host
    - proxmox_host, proxmox_token, proxmox_token_id, proxmox_token_secret
    """
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pve = cluster.get("proxmox", {})
    bgp = cluster.get("bgp", {})
    master = cluster.get("master", {})
    lic = cluster.get("license", {})

    return {
        "cluster_id": cluster_id,
        # Proxmox
        "proxmox_host": pve.get("host", ""),
        "proxmox_port": pve.get("port", 8006),
        "proxmox_node": pve.get("node", "pve01"),
        "proxmox_token": f"{pve.get('token_id', '')}={pve.get('token_secret', '')}",
        "proxmox_token_id": pve.get("token_id", ""),
        "proxmox_token_secret": pve.get("token_secret", ""),
        "template_vmid": pve.get("template_vmid", 9000),
        "cores": pve.get("cores", 4),
        "memory_mb": pve.get("memory_mb", 8192),
        # BGP
        "local_asn": bgp.get("local_asn", 65001),
        "remote_asn": bgp.get("remote_asn", 65000),
        "frr_peer_ip": bgp.get("frr_peer_ip", ""),
        "frr_ip": bgp.get("frr_ip", ""),
        "frr_user": bgp.get("frr_user", "admin"),
        "vip_network": bgp.get("vip_network", ""),
        "bgp_vlan": bgp.get("bgp_vlan", 10),
        "client_vlan": bgp.get("client_vlan", 20),
        # Master
        "master_ip": master.get("mgmt_ip", ""),
        "master_user": master.get("user", "admin"),
        "master_pass": master.get("pass", ""),
        # Licensing
        "license_pool": lic.get("pool_name", ""),
        "bigiq_host": lic.get("bigiq_host", ""),
        # Insight
        "insight_host": cluster.get("insight_host", ""),
        # Proxmox SSH (for ARP discovery steps that SSH to Proxmox host)
        "proxmox_ssh_user": pve.get("ssh_user", "root"),
        "proxmox_ssh_pass": pve.get("ssh_pass", ""),
    }


def get_proxmox_creds_for_vault(cluster_id: str) -> Optional[dict]:
    """Extract Proxmox credentials from cluster config for Vault injection.

    Returns a dict suitable for passing as `extra` to store_device_credentials(),
    enabling the executor's _execute_proxmox_step() to find Proxmox creds
    directly in the device's Vault entry (Option B).
    """
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pve = cluster.get("proxmox", {})
    return {
        "proxmox_host": pve.get("host", ""),
        "proxmox_port": pve.get("port", 8006),
        "proxmox_token_id": pve.get("token_id", ""),
        "proxmox_token_secret": pve.get("token_secret", ""),
    }


# ── License Pool Management ───────────────────────────────

def allocate_license(cluster_id: str) -> Optional[dict]:
    """Allocate the next available license regkey from the cluster's pool.

    Returns: {"regkey": "XXXXX-...", "index": N} or None if exhausted.
    """
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pool = cluster.get("license_pool", [])
    if not pool:
        logger.warning(f"Cluster {cluster_id}: no license pool configured")
        return None

    for i, entry in enumerate(pool):
        if entry.get("status") == "available":
            entry["status"] = "in_use"
            entry["allocated_at"] = datetime.now(timezone.utc).isoformat()
            cluster["license_pool"] = pool
            _save_cluster(cluster)
            logger.info(f"Allocated license {i} from cluster {cluster_id}")
            return {"regkey": entry["regkey"], "index": i}

    logger.warning(f"Cluster {cluster_id}: license pool exhausted")
    return None


def release_license(cluster_id: str, regkey: str = None,
                    index: int = None) -> bool:
    """Release a license regkey back to the pool.

    Can match by regkey string or by index.
    """
    cluster = get_cluster(cluster_id)
    if not cluster:
        return False

    pool = cluster.get("license_pool", [])

    if index is not None and 0 <= index < len(pool):
        pool[index]["status"] = "available"
        pool[index].pop("allocated_at", None)
        cluster["license_pool"] = pool
        _save_cluster(cluster)
        logger.info(f"Released license index {index} in cluster {cluster_id}")
        return True

    if regkey:
        for entry in pool:
            if entry.get("regkey") == regkey:
                entry["status"] = "available"
                entry.pop("allocated_at", None)
                cluster["license_pool"] = pool
                _save_cluster(cluster)
                logger.info(f"Released license {regkey[:10]}... in cluster {cluster_id}")
                return True

    return False


def get_license_pool_status(cluster_id: str) -> Optional[dict]:
    """Get license pool status."""
    cluster = get_cluster(cluster_id)
    if not cluster:
        return None

    pool = cluster.get("license_pool", [])
    available = sum(1 for e in pool if e.get("status") == "available")
    in_use = sum(1 for e in pool if e.get("status") == "in_use")

    return {
        "total": len(pool),
        "available": available,
        "in_use": in_use,
        "entries": pool,
    }
