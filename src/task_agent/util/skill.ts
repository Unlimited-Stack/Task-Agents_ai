export interface SkillSpec {
  name: string;
  description: string;
}

export async function loadSkill(_name: string): Promise<SkillSpec | null> {
  return null;
}
