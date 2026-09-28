/**
 * The session: who is signed in, and the four writes that change it (Section 4.2).
 * The only place the `['me']` query and the auth mutations are declared — components
 * never call `useQuery` / `useMutation` inline (CLAUDE.md section 3).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  getMe,
  login,
  logout,
  register,
  updateProfile,
  type LoginInput,
  type LoginResult,
  type ProfileInput,
  type RegisterInput,
} from '@/api/auth';
import type { User } from '@/api/types';

const ME_KEY = ['me'] as const;

/**
 * The signed-in user, fetched once on app boot (Section 5.4.1: `staleTime: Infinity`).
 * A 401 is the answer "not signed in", not a transient failure, so it is never retried;
 * `client.ts` has already redirected to `/login?next=` by the time it lands here.
 */
export function useMe(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: getMe,
    staleTime: Infinity,
    retry: false,
  });
}

/** Writes the authoritative user into the cache, then confirms it against the server. */
function refreshMe(queryClient: QueryClient, user: User): void {
  queryClient.setQueryData(ME_KEY, user);
  void queryClient.invalidateQueries({ queryKey: ME_KEY });
}

/** `POST /api/auth/login`. 401 and 429 surface on the mutation for `LoginPage` to render. */
export function useLogin(): UseMutationResult<LoginResult, Error, LoginInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (result) => refreshMe(queryClient, result.user),
  });
}

/** `POST /api/auth/register`. 403 `signup_disabled` and 409 surface on the mutation. */
export function useRegister(): UseMutationResult<User, Error, RegisterInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (user) => refreshMe(queryClient, user),
  });
}

/**
 * `POST /api/auth/logout`. The whole cache goes with the session: boards, board payloads
 * and `['me']` all belonged to the user who just left (Section 5.4.1).
 */
export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.clear(),
  });
}

/**
 * `PATCH /api/auth/me`, behind `ProfileModal`. The 400 for a wrong `current_password`
 * belongs under the field, so no toast is raised here.
 */
export function useUpdateProfile(): UseMutationResult<User, Error, ProfileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => refreshMe(queryClient, user),
  });
}
