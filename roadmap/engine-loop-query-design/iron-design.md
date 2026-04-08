Explicit else — forces you to think about every branch
Single return point per handler — makes it impossible to confuse break (switch) vs return (function)
Named handler functions — each case returns a typed result ("stop" | "continue" | "compact"), orchestrator dispatches uniformly
follow a design pattern: reactor?