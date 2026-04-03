import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('classification_feedbacks')
export class ClassificationFeedback {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  imageUrl: string;

  @Column()
  aiCategory: string;

  @Column()
  correctCategory: string;

  @CreateDateColumn()
  createdAt: Date;
}
