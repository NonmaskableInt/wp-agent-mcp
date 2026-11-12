import { execFileSync } from 'node:child_process';

/**
 * Toggles real wp-config.php constants in the dev container, so tests can exercise
 * DISALLOW_FILE_EDIT / DISALLOW_FILE_MODS / DISALLOW_UNFILTERED_HTML / AGENT_BRIDGE_* for real.
 * Every line is tagged so it can always be removed again.
 */
export const container = process.env.BRIDGE_TEST_CONTAINER;

const SCRIPT = `
$f = "/var/www/html/wp-config.php";
$s = file_get_contents($f);
[$mode, $name, $lit] = [$argv[1], $argv[2] ?? "", $argv[3] ?? ""];
if ($mode === "clear_all") {
  $s = preg_replace('/^.*\\/\\/ bridge-test:\\S+\\R/m', "", $s);
} else {
  $s = preg_replace('/^.*\\/\\/ bridge-test:' . preg_quote($name, "/") . '\\R/m', "", $s);
  if ($mode === "set") {
    $line = "define(\\"$name\\", $lit); // bridge-test:$name\\n";
    $s = preg_replace('/(\\/\\* That\\'s all)/', $line . '$1', $s, 1);
  }
}
file_put_contents($f, $s);
`;

const run = (...args: string[]) => execFileSync('podman', ['exec', container!, 'php', '-r', SCRIPT, '--', ...args], { encoding: 'utf8' });

export const set_constant = (name: string, literal = 'true') => run('set', name, literal);
export const unset_constant = (name: string) => run('unset', name);
export const clear_test_constants = () => run('clear_all');

/** Run PHP inside the container (as root) and return stdout. */
export const sh = (...cmd: string[]) => execFileSync('podman', ['exec', container!, ...cmd], { encoding: 'utf8' });

/**
 * Puts the options the option-group tests touch back to known defaults, straight through the
 * container. A failing (or deliberately mutated) run can leave the site unreachable through its own
 * API — e.g. plain permalinks remove /wp-json/ — so cleanup must not depend on the API working.
 */
export const reset_site_options = () =>
  sh('php', '-r', `
    define("WP_USE_THEMES", false); require "/var/www/html/wp-load.php";
    foreach ([
      "timezone_string" => "", "date_format" => "F j, Y", "time_format" => "g:i a", "start_of_week" => 1,
      "posts_per_page" => 10, "posts_per_rss" => 10, "default_comment_status" => "open", "default_ping_status" => "open",
      "require_name_email" => 1, "comment_registration" => 0, "close_comments_for_old_posts" => 0, "close_comments_days_old" => 14,
      "thread_comments" => 1, "comments_per_page" => 50, "thumbnail_size_w" => 150, "thumbnail_size_h" => 150,
      "medium_size_w" => 300, "medium_size_h" => 300, "large_size_w" => 1024, "large_size_h" => 1024,
      "show_on_front" => "posts", "page_on_front" => 0, "page_for_posts" => 0, "category_base" => "", "tag_base" => "",
      "blogname" => "Bridge Dev", "blogdescription" => "", "permalink_structure" => "/%postname%/",
      "siteurl" => "http://127.0.0.1:8088", "home" => "http://127.0.0.1:8088",
    ] as $k => $v) update_option($k, $v);
    flush_rewrite_rules(false);
    delete_option("ct_custom_option");
  `);
