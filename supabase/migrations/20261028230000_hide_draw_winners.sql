-- Draw results are public so anyone can verify them, but WHO won is not:
-- winner_user_id would let anyone link a draw to an account. The app works
-- out "you won" from the signed-in user's own tickets instead.
revoke select on public.draw_results from anon, authenticated;
grant select (listing_id, commitment, seed, closing_ref, winning_number, drawn_at) on public.draw_results to anon, authenticated;
