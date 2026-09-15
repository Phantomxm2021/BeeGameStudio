import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function ExampleTabs({ value, onValueChange }: { value?: string; onValueChange?: (value: string) => void }) {
  return (
    <Tabs value={value} defaultValue="one" onValueChange={onValueChange} data-testid="tabs-root">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">One content</TabsContent>
      <TabsContent value="two">Two content</TabsContent>
    </Tabs>
  );
}

describe('beUI tabs adapter', () => {
  it('uses an isolated underline id for each root', () => {
    render(
      <>
        <ExampleTabs />
        <ExampleTabs />
      </>,
    );

    const indicators = screen.getAllByTestId('beui-tabs-indicator');
    expect(indicators).toHaveLength(2);
    expect(indicators[0]).toHaveAttribute('data-layout-id');
    expect(indicators[0].getAttribute('data-layout-id')).not.toBe(indicators[1].getAttribute('data-layout-id'));
    expect(screen.getAllByRole('tab')[0]).not.toHaveClass('hover:bg-muted');
  });

  it('follows a controlled value changed by the parent', () => {
    function ControlledTabs() {
      const [value, setValue] = useState('one');
      return (
        <>
          <button type="button" onClick={() => setValue('two')}>Set two</button>
          <ExampleTabs value={value} onValueChange={setValue} />
        </>
      );
    }

    render(<ControlledTabs />);
    expect(screen.getByRole('tab', { name: 'One' })).toContainElement(screen.getByTestId('beui-tabs-indicator'));
    fireEvent.click(screen.getByRole('button', { name: 'Set two' }));
    expect(screen.getByRole('tab', { name: 'Two' })).toContainElement(screen.getByTestId('beui-tabs-indicator'));
  });
});
