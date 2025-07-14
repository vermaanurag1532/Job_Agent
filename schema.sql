
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    google_user_id VARCHAR(255) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    profile_picture VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);


CREATE TABLE session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;


CREATE INDEX idx_session_expire ON session (expire);


CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    company_name VARCHAR(255) NOT NULL,
    company_website VARCHAR(500),
    job_title VARCHAR(255) NOT NULL,
    email_type VARCHAR(50) DEFAULT 'application',
    additional_info TEXT,
    resume_path VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    email_sent TIMESTAMP,
    last_follow_up TIMESTAMP,
    follow_up_count INTEGER DEFAULT 0,
    original_email TEXT,
    email_preview TEXT,
    sender_info JSONB,
    error_message TEXT
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE users ADD COLUMN google_access_token TEXT;
ALTER TABLE users ADD COLUMN google_refresh_token TEXT;
ALTER TABLE users ADD COLUMN google_token_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN gmail_permission_granted BOOLEAN DEFAULT false;

CREATE INDEX idx_users_gmail_permission ON users(gmail_permission_granted);
CREATE INDEX idx_users_token_expiry ON users(google_token_expires_at);

ALTER TABLE users ADD COLUMN email_password TEXT;
ALTER TABLE users ADD COLUMN has_email_credentials BOOLEAN DEFAULT false;

ALTER TABLE users DROP COLUMN IF EXISTS google_access_token;
ALTER TABLE users DROP COLUMN IF EXISTS google_refresh_token;
ALTER TABLE users DROP COLUMN IF EXISTS google_token_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS gmail_permission_granted;