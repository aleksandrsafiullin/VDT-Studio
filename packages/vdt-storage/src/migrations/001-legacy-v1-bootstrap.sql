CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      industry TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS vdts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      root_kpi TEXT NOT NULL,
      unit TEXT,
      time_period TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      active_revision_id TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS vdt_revisions (
      id TEXT PRIMARY KEY,
      vdt_id TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      parent_revision_id TEXT,
      source TEXT NOT NULL,
      summary TEXT,
      file_path TEXT NOT NULL,
      graph_hash TEXT NOT NULL,
      validation_json TEXT,
      calculation_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(vdt_id, revision_no),
      FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      vdt_id TEXT,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'vdt_build',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON DELETE SET NULL
    );

CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_run_id TEXT,
      events_json TEXT,
      attachments_json TEXT,
      produced_files_json TEXT,
      run_context_json TEXT,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      vdt_id TEXT,
      conversation_id TEXT,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      request_json TEXT NOT NULL,
      public_snapshot_json TEXT,
      internal_state_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON DELETE SET NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      phase TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, seq),
      FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS mutation_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      vdt_id TEXT NOT NULL,
      base_revision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      change_set_json TEXT NOT NULL,
      preview_file_path TEXT,
      validation_json TEXT,
      calculation_json TEXT,
      created_at INTEGER NOT NULL,
      applied_at INTEGER,
      FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS vdt_comparisons (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      left_vdt_id TEXT NOT NULL,
      right_vdt_id TEXT NOT NULL,
      left_revision_id TEXT NOT NULL,
      right_revision_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
