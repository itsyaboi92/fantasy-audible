# NFL affiliation display correction

Players whose ESPN proTeamId is explicitly 0 are labeled **Free Agent (NFL)** in the Players directory and roster view. A missing team ID is labeled **NFL team unavailable**, not Free Agent. This is independent of fantasy-league availability (rostered, waivers, or available).

The ESPN normalization now also exports `nflRosterStatus` (`FREE_AGENT`, `TEAM`, or `UNKNOWN`). Historical team affiliation and Week 9 scoring evidence are retained separately, so a former Ram can be an NFL free agent without being credited with Rams kicking statistics.

This does not claim that every current NFL transaction is reflected instantly: the current ESPN feed must explicitly report free-agent status.
