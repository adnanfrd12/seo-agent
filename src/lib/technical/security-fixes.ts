/**
 * How to fix each security check: plain steps that work on any host, WordPress steps when the site runs
 * WordPress, and copy-paste config for Apache / LiteSpeed (.htaccess), Nginx and Cloudflare where it applies.
 * No server-only import: pure data, so it can be unit tested.
 */
export interface SecFix { steps: string[]; wordpress?: string[]; code?: { label: string; text: string }[] }
export type HostKind = "cloudflare" | "apache" | "litespeed" | "nginx" | "iis" | "other";
export interface FixCtx { wp: boolean; host: HostKind; domain: string }

const hostStep = (h: HostKind, cf: string, apache: string, nginx: string, other: string) =>
  h === "cloudflare" ? cf : h === "apache" || h === "litespeed" ? apache : h === "nginx" ? nginx : other;

const HEADER_CODE = (name: string, value: string): SecFix["code"] => [
  { label: "Apache / LiteSpeed (.htaccess)", text: `<IfModule mod_headers.c>\n  Header always set ${name} "${value}"\n</IfModule>` },
  { label: "Nginx (server block)", text: `add_header ${name} "${value}" always;` },
  { label: "Cloudflare", text: `Rules → Transform Rules → Modify Response Header → Set static\n${name}: ${value}` },
];

export function fixFor(id: string, c: FixCtx): SecFix {
  const where = hostStep(c.host,
    "Your site is behind Cloudflare: the quickest place is Cloudflare → Rules → Transform Rules → Modify Response Header.",
    "Your server runs Apache/LiteSpeed: add the line to the .htaccess file in the site's root folder (back it up first).",
    "Your server runs Nginx: add the line to the site's server { } block and reload Nginx.",
    "Ask your host to add the response header, or add it in your CDN / server config.");
  switch (id) {
    case "https_redirect": return {
      steps: ["Make every http:// address answer with a permanent (301) redirect to the same https:// address.",
        hostStep(c.host, "Cloudflare → SSL/TLS → Edge Certificates → turn on “Always Use HTTPS”.", "Add the .htaccess rule below at the top of the file.", "Add the Nginx server block below for port 80.", "In your hosting panel turn on “Force HTTPS”, or ask your host to."),
        "Open http://" + c.domain + " in a private window and confirm the address bar ends on https://."],
      wordpress: ["Settings → General: both “WordPress Address” and “Site Address” must start with https://.", "If you use Really Simple SSL (or a similar plugin), turn on its 301 redirect option instead of editing files."],
      code: [
        { label: "Apache / LiteSpeed (.htaccess)", text: "RewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]" },
        { label: "Nginx", text: `server {\n  listen 80;\n  server_name ${c.domain} www.${c.domain};\n  return 301 https://$host$request_uri;\n}` },
      ],
    };
    case "tls_cert": return {
      steps: ["Install a valid certificate that covers both " + c.domain + " and www." + c.domain + " (free from Let’s Encrypt in most hosting panels: “SSL/TLS” or “AutoSSL”).",
        "Make sure the full chain (intermediate certificates) is installed, not only the site certificate.",
        "Turn off TLS 1.0 and 1.1 so only TLS 1.2 and 1.3 are offered.",
        "Re-check with ssllabs.com/ssltest after the change."],
      wordpress: ["Managed WordPress hosts (SiteGround, Kinsta, WP Engine, Hostinger…) issue the certificate from their dashboard: open the SSL section and re-issue it for both the www and non-www name."],
    };
    case "tls_expiry": return {
      steps: ["Renew the certificate before it expires, then turn on automatic renewal (Let’s Encrypt / AutoSSL renew every 60-90 days on their own).",
        "If renewal keeps failing, check the domain’s DNS still points at this server and that /.well-known/acme-challenge/ isn’t blocked.",
        "Behind Cloudflare: SSL/TLS → Edge Certificates shows the certificate Cloudflare serves and renews it for you."],
    };
    case "hsts": return {
      steps: ["Only after HTTPS works on every page and subdomain: send Strict-Transport-Security with max-age of at least 6 months.", where,
        "Start with max-age=300 for a day, then raise it to 31536000; add includeSubDomains only when every subdomain has HTTPS."],
      wordpress: ["Plugins such as Really Simple SSL (Pro) or Headers Security Advanced & HSTS WP can add the header without editing files."],
      code: [...HEADER_CODE("Strict-Transport-Security", "max-age=31536000; includeSubDomains")!.slice(0, 2), { label: "Cloudflare", text: "SSL/TLS → Edge Certificates → HTTP Strict Transport Security (HSTS) → Enable, max-age 12 months" }],
    };
    case "csp": return {
      steps: ["Add a Content-Security-Policy so the browser only runs scripts from sources you allow (main defence against injected scripts).",
        "Start in report-only mode (Content-Security-Policy-Report-Only) for a week, check the browser console for blocked items, then switch to the enforcing header.",
        where, "A safe first step that breaks nothing is the policy below; tighten script-src later."],
      wordpress: ["Use a plugin such as “Headers Security Advanced & HSTS WP” or “HTTP Headers” to add the policy from the dashboard.", "Page builders and analytics need their domains allowed (e.g. www.googletagmanager.com, www.google-analytics.com)."],
      code: HEADER_CODE("Content-Security-Policy", "upgrade-insecure-requests; frame-ancestors 'self'; object-src 'none'; base-uri 'self'"),
    };
    case "frame_options": return {
      steps: ["Stop other sites from showing your pages inside an iframe (clickjacking): send X-Frame-Options: SAMEORIGIN, or frame-ancestors 'self' in your Content-Security-Policy.", where],
      wordpress: ["WordPress already sends this header on the login and admin pages; a headers plugin can add it site-wide."],
      code: HEADER_CODE("X-Frame-Options", "SAMEORIGIN"),
    };
    case "content_type_options": return { steps: ["Send X-Content-Type-Options: nosniff so browsers don’t guess file types (blocks some script-injection tricks).", where], wordpress: ["A headers plugin can add it, or add the .htaccess line below."], code: HEADER_CODE("X-Content-Type-Options", "nosniff") };
    case "referrer_policy": return { steps: ["Send Referrer-Policy: strict-origin-when-cross-origin so full page addresses (which may contain search terms or IDs) aren’t passed to other sites.", where], code: HEADER_CODE("Referrer-Policy", "strict-origin-when-cross-origin") };
    case "permissions_policy": return { steps: ["Send a Permissions-Policy that switches off browser features the site doesn’t use (camera, microphone, location…), so injected code can’t use them.", where], code: HEADER_CODE("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()") };
    case "server_disclosure": return {
      steps: ["Hide software version numbers from the Server and X-Powered-By headers: they tell attackers exactly which known bugs to try.",
        "If PHP is older than 8.2, upgrade it in your hosting panel (“PHP version” / “MultiPHP Manager”): old versions get no security fixes."],
      wordpress: ["Upgrade PHP from the hosting panel after checking Tools → Site Health for plugin compatibility.", "Take a full backup before changing PHP version."],
      code: [
        { label: "Apache (httpd.conf) + PHP (php.ini)", text: "ServerTokens Prod\nServerSignature Off\n# php.ini\nexpose_php = Off" },
        { label: "Nginx", text: "server_tokens off;\n# php.ini\nexpose_php = Off" },
      ],
    };
    case "mixed_content": return {
      steps: ["Change every http:// script, stylesheet, iframe and image address on the page to https:// (or a relative //path).",
        "Browsers block insecure scripts and styles on an https page, so parts of the page may already be broken for visitors.",
        "As a safety net add the header Content-Security-Policy: upgrade-insecure-requests."],
      wordpress: ["Run Better Search Replace (or WP-CLI: wp search-replace 'http://" + c.domain + "' 'https://" + c.domain + "' --all-tables) after a backup.", "Check theme options, page-builder settings and widgets for hard-coded http:// links."],
    };
    case "cookies": return {
      steps: ["Every cookie set over HTTPS should have the Secure flag; login/session cookies also need HttpOnly; all cookies should have SameSite=Lax (or Strict).",
        "Find which plugin or app sets the cookie named in the evidence and update it, or set the flags in the server config below."],
      wordpress: ["WordPress’s own login cookies are already Secure/HttpOnly when the site uses https; flagged cookies usually come from a plugin (chat, cache, forms). Update or replace that plugin.", "For PHP sessions set in php.ini: session.cookie_secure=1, session.cookie_httponly=1, session.cookie_samesite=Lax."],
      code: [
        { label: "Apache (.htaccess, mod_headers)", text: "Header always edit Set-Cookie ^(.*)$ \"$1; Secure; HttpOnly; SameSite=Lax\" \"expr=%{resp:Set-Cookie} !~ /SameSite/\"" },
        { label: "Nginx 1.19.3+", text: "proxy_cookie_flags ~ secure httponly samesite=lax;" },
      ],
    };
    case "cors": return {
      steps: ["Remove Access-Control-Allow-Origin from normal HTML pages; it’s only needed on APIs or fonts that other sites must read.",
        "Never combine a reflected or * origin with Access-Control-Allow-Credentials: true.",
        "If a CDN or plugin adds it everywhere, limit the rule to the files that need it (e.g. fonts)."],
      wordpress: ["Look for CORS settings in caching/CDN plugins (WP Rocket, W3 Total Cache) or a custom header in .htaccess."],
    };
    case "exposed_files": return {
      steps: ["Delete the listed files from the web server right away (use FTP / the hosting file manager), and move backups outside the public folder.",
        "Treat anything in an exposed .env, config backup or .git folder as leaked: change those database passwords and API keys.",
        "Block these paths for the future with the rules below."],
      wordpress: ["For an exposed debug.log: in wp-config.php set define('WP_DEBUG_LOG', false); (or log to a path outside wp-content) and delete wp-content/debug.log.", "Backup plugins (UpdraftPlus, Duplicator) should store backups off-site, not in the public folder."],
      code: [
        { label: "Apache / LiteSpeed (.htaccess)", text: "RedirectMatch 404 /\\.(git|env|DS_Store)\n<FilesMatch \"\\.(bak|sql|zip|tar|gz|log)$|^phpinfo\\.php$\">\n  Require all denied\n</FilesMatch>" },
        { label: "Nginx", text: "location ~ /\\.(git|env|DS_Store) { deny all; return 404; }\nlocation ~* \\.(bak|sql|zip|tar|gz|log)$ { deny all; }" },
      ],
    };
    case "directory_listing": return {
      steps: ["Turn off directory listing so visitors can’t browse every uploaded file.", hostStep(c.host, "Cloudflare can’t turn this off: change it on the origin server (rule below).", "Add “Options -Indexes” to .htaccess.", "Make sure “autoindex off;” is set (it’s the default).", "Ask your host to turn off directory indexes.")],
      wordpress: ["Add Options -Indexes to the .htaccess in the WordPress root; Wordfence or Solid Security can also do it."],
      code: [{ label: "Apache / LiteSpeed (.htaccess)", text: "Options -Indexes" }, { label: "Nginx", text: "autoindex off;" }],
    };
    case "security_txt": return {
      steps: ["Publish /.well-known/security.txt so people who find a problem know whom to tell (RFC 9116).", "Use a mailbox someone reads and set Expires to within a year."],
      wordpress: ["Upload the file with the hosting file manager into a folder named .well-known in the site root (or use the “WP Security.txt” plugin)."],
      code: [{ label: "/.well-known/security.txt", text: `Contact: mailto:security@${c.domain}\nExpires: ${new Date(Date.now() + 330 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z\nPreferred-Languages: en` }],
    };
    case "outdated_js": return {
      steps: ["Update the listed libraries to their current versions (jQuery 3.7+, Bootstrap 3.4.1 / 4.3.1+ / 5.x, jQuery UI 1.13+); old versions have published XSS bugs.",
        "Check the page still works after the update (sliders, menus, forms)."],
      wordpress: ["Update WordPress core, the theme and all plugins (Dashboard → Updates); WordPress ships a current jQuery itself.", "If a theme or plugin loads its own old copy, update it or ask its developer; remove “jQuery Migrate”-style helpers that load old versions."],
    };
    case "spf": return {
      steps: ["Publish one SPF TXT record on " + c.domain + " listing every service that sends your email, ending in ~all (or -all once you’re sure).",
        "Only one v=spf1 record is allowed; merge them if there are several.",
        "Add it at your DNS provider (where the domain’s nameservers point, e.g. Cloudflare, GoDaddy, Namecheap)."],
      code: [{ label: "DNS TXT record on " + c.domain, text: "v=spf1 include:_spf.google.com ~all\n# Google Workspace shown; Microsoft 365: include:spf.protection.outlook.com\n# add include: entries for your website mailer / newsletter tool" }],
    };
    case "dmarc": return {
      steps: ["Add a DMARC TXT record at _dmarc." + c.domain + " so receivers reject mail that pretends to come from your domain.",
        "Start with p=none and a report address, check the reports for a few weeks, then move to p=quarantine and finally p=reject."],
      code: [{ label: "DNS TXT record on _dmarc." + c.domain, text: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${c.domain}; adkim=s; aspf=s` }],
    };
    case "wp_version": return {
      steps: ["Hide the WordPress version so attackers can’t match it to known bugs (keeping WordPress updated matters more)."],
      wordpress: ["Add the snippet below to the child theme’s functions.php (or use the Code Snippets plugin), or turn on “Hide WP version” in Wordfence / Solid Security / Perfmatters."],
      code: [{ label: "functions.php", text: "remove_action('wp_head', 'wp_generator');\nadd_filter('the_generator', '__return_empty_string');" }],
    };
    case "wp_core_outdated": return {
      steps: ["Update WordPress to the latest release after a full backup (Dashboard → Updates).", "Turn on automatic minor (security) updates; they are on by default unless a plugin or wp-config.php disabled them."],
      wordpress: ["Check wp-config.php doesn’t contain define('WP_AUTO_UPDATE_CORE', false); or define('AUTOMATIC_UPDATER_DISABLED', true);.", "Update plugins and the theme in the same session; most hacked WordPress sites are hit through an old plugin."],
    };
    case "wp_readme": return {
      steps: ["Delete readme.html (and license.txt) from the site root: they confirm the site runs WordPress and help automated attacks."],
      wordpress: ["They come back after each core update; block them with the rule below or a security plugin."],
      code: [{ label: "Apache / LiteSpeed (.htaccess)", text: "<FilesMatch \"^(readme\\.html|license\\.txt)$\">\n  Require all denied\n</FilesMatch>" }, { label: "Nginx", text: "location ~* ^/(readme\\.html|license\\.txt)$ { deny all; }" }],
    };
    case "wp_user_enum": return {
      steps: ["Stop the site from listing login usernames: they are half of what a password-guessing attack needs.", "Make sure every admin account uses a strong unique password and two-factor login."],
      wordpress: ["In Wordfence: All Options → “Prevent discovery of usernames through ‘/?author=N’ scans, the oEmbed API, the WordPress REST API, and WordPress XML Sitemaps”. Solid Security and All-In-One Security have the same switch.", "Or add the snippet below to the child theme’s functions.php.", "Set each user’s “Display name publicly as” to something other than the login name."],
      code: [{ label: "functions.php", text: "add_filter('rest_endpoints', function ($e) {\n  if (!is_user_logged_in()) { unset($e['/wp/v2/users'], $e['/wp/v2/users/(?P<id>[\\d]+)']); }\n  return $e;\n});\nadd_action('template_redirect', function () {\n  if (is_author() && !is_user_logged_in()) { wp_redirect(home_url(), 301); exit; }\n});" }],
    };
    case "wp_xmlrpc": return {
      steps: ["Turn off XML-RPC unless you use the WordPress mobile app or Jetpack: attackers use it to try hundreds of passwords per request."],
      wordpress: ["Wordfence → All Options → “Disable XML-RPC authentication”, or the “Disable XML-RPC-API” plugin.", "Or block the file with the rule below (Jetpack users: allow only Jetpack’s IPs instead)."],
      code: [{ label: "Apache / LiteSpeed (.htaccess)", text: "<Files xmlrpc.php>\n  Require all denied\n</Files>" }, { label: "Nginx", text: "location = /xmlrpc.php { deny all; }" }],
    };
    default: return { steps: [] };
  }
}
