<script lang="ts">
	import UserMenu from '$lib/components/UserMenu.svelte';

	let { data, children } = $props();
</script>

<UserMenu user={data.user ? { email: data.user.email, isAdmin: data.user.isAdmin } : null} />
{@render children()}
