-- SaaS Base Schema Phase 1
-- Tables: saas_users, saas_projects, saas_quizzes, saas_game_sessions
-- All tables have RLS enabled with ownership-based policies

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS saas_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_users_email ON saas_users(email);

DROP TRIGGER IF EXISTS update_saas_users_updated_at ON saas_users;
CREATE TRIGGER update_saas_users_updated_at
  BEFORE UPDATE ON saas_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE saas_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own record"
  ON saas_users FOR SELECT
  TO authenticated
  USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update own record"
  ON saas_users FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = id::text)
  WITH CHECK (auth.uid()::text = id::text);

CREATE TABLE IF NOT EXISTS saas_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_projects_user_id ON saas_projects(user_id);

DROP TRIGGER IF EXISTS update_saas_projects_updated_at ON saas_projects;
CREATE TRIGGER update_saas_projects_updated_at
  BEFORE UPDATE ON saas_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE saas_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own projects"
  ON saas_projects FOR SELECT
  TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "Users can insert own projects"
  ON saas_projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can update own projects"
  ON saas_projects FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can delete own projects"
  ON saas_projects FOR DELETE
  TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE TABLE IF NOT EXISTS saas_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text,
  data_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_quizzes_project_id ON saas_quizzes(project_id);

DROP TRIGGER IF EXISTS update_saas_quizzes_updated_at ON saas_quizzes;
CREATE TRIGGER update_saas_quizzes_updated_at
  BEFORE UPDATE ON saas_quizzes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE saas_quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own quizzes"
  ON saas_quizzes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_projects p
      WHERE p.id = saas_quizzes.project_id
      AND p.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert own quizzes"
  ON saas_quizzes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM saas_projects p
      WHERE p.id = saas_quizzes.project_id
      AND p.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can update own quizzes"
  ON saas_quizzes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_projects p
      WHERE p.id = saas_quizzes.project_id
      AND p.user_id::text = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM saas_projects p
      WHERE p.id = saas_quizzes.project_id
      AND p.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete own quizzes"
  ON saas_quizzes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_projects p
      WHERE p.id = saas_quizzes.project_id
      AND p.user_id::text = auth.uid()::text
    )
  );

CREATE TABLE IF NOT EXISTS saas_game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES saas_quizzes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'created',
  overlay_token text UNIQUE,
  overlay_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT saas_game_sessions_status_check
    CHECK (status IN ('created', 'starting', 'running', 'stopped'))
);

CREATE INDEX IF NOT EXISTS idx_saas_game_sessions_user_id ON saas_game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_game_sessions_quiz_id ON saas_game_sessions(quiz_id);

DROP TRIGGER IF EXISTS update_saas_game_sessions_updated_at ON saas_game_sessions;
CREATE TRIGGER update_saas_game_sessions_updated_at
  BEFORE UPDATE ON saas_game_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE saas_game_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own sessions"
  ON saas_game_sessions FOR SELECT
  TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "Users can insert own sessions"
  ON saas_game_sessions FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can update own sessions"
  ON saas_game_sessions FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can delete own sessions"
  ON saas_game_sessions FOR DELETE
  TO authenticated
  USING (user_id::text = auth.uid()::text);
