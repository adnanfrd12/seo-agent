-- More features record their Claude cost in ai_usage_events: indexing diagnoses, site audit fixes and alt text,
-- security audit explanations, fan-out queries and Business Profile insights.
alter table public.ai_usage_events drop constraint if exists ai_usage_events_feature_check;
alter table public.ai_usage_events add constraint ai_usage_events_feature_check check (feature in (
  'blog_geo', 'toolkit_content', 'toolkit_brief', 'toolkit_comparison',
  'gsc_indexing', 'site_audit_ai', 'alt_text', 'security_ai', 'fanout', 'gbp_ai'
));
